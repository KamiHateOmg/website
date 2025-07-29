const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            error: 'Access token required'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database to ensure they still exist and are active
        const pool = req.app.locals.db;
        const userResult = await pool.query(
            'SELECT id, email, role, email_verified, is_active, hwid FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                error: 'User not found'
            });
        }

        const user = userResult.rows[0];

        if (!user.is_active) {
            return res.status(401).json({
                error: 'Account is disabled'
            });
        }

        // Add user info to request object
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            emailVerified: user.email_verified,
            hwid: user.hwid
        };

        next();
    } catch (error) {
        logger.error('Token verification error:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired'
            });
        } else if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token'
            });
        } else {
            return res.status(500).json({
                error: 'Token verification failed'
            });
        }
    }
};

// Check if user has required role
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required'
            });
        }

        // Convert single role to array
        const allowedRoles = Array.isArray(roles) ? roles : [roles];
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                required: allowedRoles,
                current: req.user.role
            });
        }

        next();
    };
};

// Check if user has admin or staff role
const requireStaff = requireRole(['admin', 'staff']);

// Check if user has admin role
const requireAdmin = requireRole(['admin']);

// Check if email is verified (optional middleware)
const requireEmailVerification = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required'
        });
    }

    if (!req.user.emailVerified) {
        return res.status(403).json({
            error: 'Email verification required',
            emailVerified: false
        });
    }

    next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // No token provided, continue without authentication
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const pool = req.app.locals.db;
        const userResult = await pool.query(
            'SELECT id, email, role, email_verified, is_active, hwid FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (userResult.rows.length > 0 && userResult.rows[0].is_active) {
            const user = userResult.rows[0];
            req.user = {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.email_verified,
                hwid: user.hwid
            };
        } else {
            req.user = null;
        }
    } catch (error) {
        // Invalid token, continue without authentication
        req.user = null;
    }

    next();
};

// HWID validation middleware
const validateHWID = (req, res, next) => {
    const { hwid } = req.body;

    if (!hwid) {
        return res.status(400).json({
            error: 'HWID is required'
        });
    }

    // Basic HWID validation (adjust pattern as needed)
    const hwidPattern = /^[A-Za-z0-9-]{10,255}$/;
    if (!hwidPattern.test(hwid)) {
        return res.status(400).json({
            error: 'Invalid HWID format'
        });
    }

    next();
};

// Rate limiting for sensitive operations
const sensitiveOperationLimit = (maxAttempts = 3, windowMs = 15 * 60 * 1000) => {
    const attempts = new Map();

    return (req, res, next) => {
        const key = `${req.ip}:${req.user?.id || 'anonymous'}`;
        const now = Date.now();
        
        // Clean old attempts
        for (const [attemptKey, data] of attempts.entries()) {
            if (now - data.timestamp > windowMs) {
                attempts.delete(attemptKey);
            }
        }

        const userAttempts = attempts.get(key) || { count: 0, timestamp: now };

        if (userAttempts.count >= maxAttempts) {
            return res.status(429).json({
                error: 'Too many attempts, please try again later',
                retryAfter: Math.ceil((userAttempts.timestamp + windowMs - now) / 1000)
            });
        }

        // Increment attempt counter
        attempts.set(key, {
            count: userAttempts.count + 1,
            timestamp: userAttempts.timestamp
        });

        // Reset counter on successful operation (call this in your route handler)
        req.resetSensitiveLimit = () => {
            attempts.delete(key);
        };

        next();
    };
};

// Audit logging middleware
const auditLog = (action) => {
    return async (req, res, next) => {
        const originalSend = res.send;
        
        res.send = function(data) {
            // Log the action after response is sent
            setImmediate(async () => {
                try {
                    const pool = req.app.locals.db;
                    const success = res.statusCode < 400;
                    
                    await pool.query(
                        'INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
                        [
                            req.user?.id || null,
                            `${action}_${success ? 'SUCCESS' : 'FAILED'}`,
                            JSON.stringify({
                                method: req.method,
                                path: req.path,
                                statusCode: res.statusCode,
                                body: req.method !== 'GET' ? req.body : undefined
                            }),
                            req.ip,
                            req.get('User-Agent')
                        ]
                    );
                } catch (error) {
                    logger.error('Audit logging failed:', error);
                }
            });

            originalSend.call(this, data);
        };

        next();
    };
};

module.exports = {
    authenticateToken,
    requireRole,
    requireStaff,
    requireAdmin,
    requireEmailVerification,
    optionalAuth,
    validateHWID,
    sensitiveOperationLimit,
    auditLog
};