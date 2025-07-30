const logger = require('../utils/logger');

// Role hierarchy definition
const ROLE_HIERARCHY = {
    'user': 0,
    'staff': 1,
    'admin': 2
};

// Permission definitions
const PERMISSIONS = {
    // User permissions
    'user:read_profile': ['user', 'staff', 'admin'],
    'user:update_profile': ['user', 'staff', 'admin'],
    'user:redeem_key': ['user', 'staff', 'admin'],
    'user:view_subscriptions': ['user', 'staff', 'admin'],
    
    // Product permissions
    'product:read': ['user', 'staff', 'admin'],
    'product:create': ['admin'],
    'product:update': ['admin'],
    'product:delete': ['admin'],
    
    // Key permissions
    'key:redeem': ['user', 'staff', 'admin'],
    'key:generate': ['staff', 'admin'],
    'key:view_all': ['staff', 'admin'],
    'key:revoke': ['admin'],
    
    // Admin permissions
    'admin:view_dashboard': ['staff', 'admin'],
    'admin:view_users': ['staff', 'admin'],
    'admin:manage_users': ['admin'],
    'admin:view_logs': ['staff', 'admin'],
    'admin:system_maintenance': ['admin'],
    'admin:export_data': ['staff', 'admin'],
    
    // Subscription permissions
    'subscription:view_own': ['user', 'staff', 'admin'],
    'subscription:view_all': ['staff', 'admin'],
    'subscription:manage': ['admin'],
    
    // Purchase permissions
    'purchase:create': ['user', 'staff', 'admin'],
    'purchase:view_own': ['user', 'staff', 'admin'],
    'purchase:view_all': ['staff', 'admin'],
    'purchase:refund': ['admin']
};

// Check if user has required role
const hasRole = (userRole, requiredRoles) => {
    if (!userRole || !requiredRoles) return false;
    
    const rolesArray = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    return rolesArray.includes(userRole);
};

// Check if user has minimum role level
const hasMinimumRole = (userRole, minimumRole) => {
    if (!userRole || !minimumRole) return false;
    
    const userLevel = ROLE_HIERARCHY[userRole];
    const minimumLevel = ROLE_HIERARCHY[minimumRole];
    
    return userLevel !== undefined && minimumLevel !== undefined && userLevel >= minimumLevel;
};

// Check if user has specific permission
const hasPermission = (userRole, permission) => {
    if (!userRole || !permission) return false;
    
    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles) {
        logger.warn('Unknown permission checked', { permission, userRole });
        return false;
    }
    
    return allowedRoles.includes(userRole);
};

// Middleware factory for role checking
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        if (!hasRole(req.user.role, roles)) {
            logger.warn('Role access denied', {
                userId: req.user.id,
                userRole: req.user.role,
                requiredRoles: roles,
                path: req.path,
                method: req.method
            });

            return res.status(403).json({
                error: 'Insufficient permissions',
                required: Array.isArray(roles) ? roles : [roles],
                current: req.user.role,
                code: 'INSUFFICIENT_ROLE'
            });
        }

        next();
    };
};

// Middleware factory for minimum role level checking
const requireMinimumRole = (minimumRole) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        if (!hasMinimumRole(req.user.role, minimumRole)) {
            logger.warn('Minimum role access denied', {
                userId: req.user.id,
                userRole: req.user.role,
                minimumRole: minimumRole,
                path: req.path,
                method: req.method
            });

            return res.status(403).json({
                error: 'Insufficient role level',
                minimum: minimumRole,
                current: req.user.role,
                code: 'INSUFFICIENT_ROLE_LEVEL'
            });
        }

        next();
    };
};

// Middleware factory for permission checking
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        if (!hasPermission(req.user.role, permission)) {
            logger.warn('Permission access denied', {
                userId: req.user.id,
                userRole: req.user.role,
                permission: permission,
                path: req.path,
                method: req.method
            });

            return res.status(403).json({
                error: 'Permission denied',
                permission: permission,
                userRole: req.user.role,
                code: 'PERMISSION_DENIED'
            });
        }

        next();
    };
};

// Resource ownership checking middleware
const requireOwnership = (resourceType, resourceIdField = 'id') => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        // Admins can access any resource
        if (req.user.role === 'admin') {
            return next();
        }

        const resourceId = req.params[resourceIdField];
        if (!resourceId) {
            return res.status(400).json({
                error: 'Resource ID required',
                code: 'RESOURCE_ID_REQUIRED'
            });
        }

        try {
            const pool = req.app.locals.db;
            let query;
            let params;

            switch (resourceType) {
                case 'subscription':
                    query = 'SELECT user_id FROM subscriptions WHERE id = $1';
                    params = [resourceId];
                    break;
                case 'key':
                    query = 'SELECT purchased_by, redeemed_by FROM keys WHERE id = $1';
                    params = [resourceId];
                    break;
                case 'purchase':
                    query = 'SELECT user_id FROM purchases WHERE id = $1';
                    params = [resourceId];
                    break;
                default:
                    return res.status(400).json({
                        error: 'Unknown resource type',
                        code: 'UNKNOWN_RESOURCE_TYPE'
                    });
            }

            const result = await pool.query(query, params);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Resource not found',
                    code: 'RESOURCE_NOT_FOUND'
                });
            }

            const resource = result.rows[0];
            let isOwner = false;

            switch (resourceType) {
                case 'subscription':
                case 'purchase':
                    isOwner = resource.user_id === req.user.id;
                    break;
                case 'key':
                    isOwner = resource.purchased_by === req.user.id || resource.redeemed_by === req.user.id;
                    break;
            }

            if (!isOwner) {
                logger.warn('Resource ownership denied', {
                    userId: req.user.id,
                    resourceType: resourceType,
                    resourceId: resourceId,
                    path: req.path,
                    method: req.method
                });

                return res.status(403).json({
                    error: 'Resource access denied',
                    code: 'RESOURCE_ACCESS_DENIED'
                });
            }

            next();
        } catch (error) {
            logger.error('Ownership check error', {
                error: error.message,
                userId: req.user.id,
                resourceType: resourceType,
                resourceId: resourceId
            });

            res.status(500).json({
                error: 'Ownership verification failed',
                code: 'OWNERSHIP_CHECK_FAILED'
            });
        }
    };
};

// Conditional role checking (allows different roles based on conditions)
const conditionalRole = (conditions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        let requiredRoles = null;

        // Evaluate conditions
        for (const condition of conditions) {
            if (condition.condition(req)) {
                requiredRoles = condition.roles;
                break;
            }
        }

        // If no condition matched, deny access
        if (!requiredRoles) {
            return res.status(403).json({
                error: 'No matching access condition',
                code: 'NO_MATCHING_CONDITION'
            });
        }

        if (!hasRole(req.user.role, requiredRoles)) {
            return res.status(403).json({
                error: 'Insufficient permissions for this condition',
                required: requiredRoles,
                current: req.user.role,
                code: 'CONDITIONAL_ACCESS_DENIED'
            });
        }

        next();
    };
};

// Rate limiting based on role
const roleBasedRateLimit = (rateLimits) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(); // Let other middleware handle auth
        }

        const userRole = req.user.role;
        const rateLimit = rateLimits[userRole] || rateLimits.default;

        if (rateLimit) {
            // Apply the rate limit for this role
            // This would integrate with your rate limiting system
            req.roleRateLimit = rateLimit;
        }

        next();
    };
};

// Middleware to check if user can perform action on specific HWID
const requireHwidAccess = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    // Admins can access any HWID
    if (req.user.role === 'admin') {
        return next();
    }

    // Staff can access any HWID for support purposes
    if (req.user.role === 'staff') {
        return next();
    }

    const requestedHwid = req.params.hwid || req.body.hwid;
    const userHwid = req.user.hwid;

    if (requestedHwid && userHwid && requestedHwid !== userHwid) {
        logger.warn('HWID access denied', {
            userId: req.user.id,
            userHwid: userHwid,
            requestedHwid: requestedHwid,
            path: req.path
        });

        return res.status(403).json({
            error: 'HWID access denied',
            code: 'HWID_ACCESS_DENIED'
        });
    }

    next();
};

// Middleware to ensure email is verified for certain actions
const requireEmailVerification = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    if (!req.user.emailVerified) {
        return res.status(403).json({
            error: 'Email verification required',
            emailVerified: false,
            code: 'EMAIL_VERIFICATION_REQUIRED'
        });
    }

    next();
};

// Utility function to get user permissions
const getUserPermissions = (userRole) => {
    const userPermissions = [];
    
    for (const [permission, allowedRoles] of Object.entries(PERMISSIONS)) {
        if (allowedRoles.includes(userRole)) {
            userPermissions.push(permission);
        }
    }
    
    return userPermissions;
};

// Predefined role middleware
const requireUser = requireRole(['user', 'staff', 'admin']);
const requireStaff = requireRole(['staff', 'admin']);
const requireAdmin = requireRole(['admin']);

// Export all middleware and utilities
module.exports = {
    // Core functions
    hasRole,
    hasMinimumRole,
    hasPermission,
    getUserPermissions,
    
    // Middleware factories
    requireRole,
    requireMinimumRole,
    requirePermission,
    requireOwnership,
    conditionalRole,
    roleBasedRateLimit,
    
    // Specific middleware
    requireUser,
    requireStaff,
    requireAdmin,
    requireHwidAccess,
    requireEmailVerification,
    
    // Constants
    ROLE_HIERARCHY,
    PERMISSIONS
};