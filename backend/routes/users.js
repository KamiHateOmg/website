const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult, query } = require('express-validator');
const { authenticateToken, requireStaff, requireAdmin, auditLog } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
    const pool = req.app.locals.db;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT id, email, role, email_verified, created_at, last_login, last_ip, hwid
             FROM users WHERE id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = result.rows[0];

        res.json({
            id: user.id,
            email: user.email,
            role: user.role,
            emailVerified: user.email_verified,
            createdAt: user.created_at,
            lastLogin: user.last_login,
            lastIp: user.last_ip,
            hwid: user.hwid
        });

    } catch (error) {
        logger.error('Error fetching user profile:', error);
        res.status(500).json({
            error: 'Failed to fetch user profile'
        });
    }
});

// Update user profile
router.put('/me', 
    authenticateToken,
    auditLog('USER_PROFILE_UPDATE'),
    [
        body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
        body('currentPassword').optional().isLength({ min: 1 }).withMessage('Current password is required for updates'),
        body('newPassword').optional().isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, currentPassword, newPassword } = req.body;
        const pool = req.app.locals.db;
        const userId = req.user.id;

        try {
            // If password change is requested, verify current password
            if (newPassword) {
                if (!currentPassword) {
                    return res.status(400).json({
                        error: 'Current password is required to set new password'
                    });
                }

                const userResult = await pool.query(
                    'SELECT password_hash FROM users WHERE id = $1',
                    [userId]
                );

                const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
                if (!isValidPassword) {
                    return res.status(400).json({
                        error: 'Current password is incorrect'
                    });
                }

                const saltRounds = 12;
                const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

                await pool.query(
                    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [newPasswordHash, userId]
                );
            }

            // Update email if provided (with re-verification required)
            if (email && email !== req.user.email) {
                // Check if email is already taken
                const emailCheck = await pool.query(
                    'SELECT id FROM users WHERE email = $1 AND id != $2',
                    [email, userId]
                );

                if (emailCheck.rows.length > 0) {
                    return res.status(409).json({
                        error: 'Email address is already in use'
                    });
                }

                // Generate new verification token
                const crypto = require('crypto');
                const emailVerificationToken = crypto.randomBytes(32).toString('hex');

                await pool.query(
                    `UPDATE users SET email = $1, email_verified = FALSE, 
                     email_verification_token = $2, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = $3`,
                    [email, emailVerificationToken, userId]
                );

                // TODO: Send verification email
                return res.json({
                    message: 'Profile updated. Please verify your new email address.',
                    emailChanged: true,
                    requiresVerification: true
                });
            }

            res.json({
                message: 'Profile updated successfully'
            });

        } catch (error) {
            logger.error('Error updating user profile:', error);
            res.status(500).json({
                error: 'Failed to update profile'
            });
        }
    }
);

// Get user's active subscription
router.get('/subscription', authenticateToken, async (req, res) => {
    const pool = req.app.locals.db;
    const userId = req.user.id;

    try {
        // Get user's HWID first
        const userResult = await pool.query(
            'SELECT hwid FROM users WHERE id = $1',
            [userId]
        );

        const userHwid = userResult.rows[0]?.hwid;
        if (!userHwid) {
            return res.json({
                isActive: false,
                subscription: null
            });
        }

        // Get active subscription for user's HWID
        const subscriptionResult = await pool.query(
            `SELECT s.id, s.starts_at, s.expires_at, s.is_active, s.hwid,
                    p.name as product_name, p.duration_days, p.price,
                    k.key_code
             FROM subscriptions s
             JOIN products p ON s.product_id = p.id
             JOIN keys k ON s.key_id = k.id
             WHERE s.hwid = $1 AND s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP
             ORDER BY s.expires_at DESC
             LIMIT 1`,
            [userHwid]
        );

        if (subscriptionResult.rows.length === 0) {
            return res.json({
                isActive: false,
                subscription: null
            });
        }

        const subscription = subscriptionResult.rows[0];

        // Calculate days remaining
        const now = new Date();
        const expiresAt = new Date(subscription.expires_at);
        const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

        res.json({
            isActive: true,
            subscription: {
                id: subscription.id,
                productName: subscription.product_name,
                keyCode: subscription.key_code,
                startsAt: subscription.starts_at,
                expiresAt: subscription.expires_at,
                daysRemaining: Math.max(0, daysRemaining),
                hwid: subscription.hwid,
                isLifetime: subscription.duration_days === 999999,
                durationDays: subscription.duration_days,
                price: parseFloat(subscription.price)
            }
        });

    } catch (error) {
        logger.error('Error fetching user subscription:', error);
        res.status(500).json({
            error: 'Failed to fetch subscription status'
        });
    }
});

// Get user's keys
router.get('/keys', authenticateToken, async (req, res) => {
    const pool = req.app.locals.db;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT k.id, k.key_code, k.redeemed_at, k.expires_at, k.is_active,
                    k.hwid_lock, k.created_at, k.redemption_ip,
                    p.name as product_name, p.duration_days, p.price,
                    s.expires_at as subscription_expires
             FROM keys k
             JOIN products p ON k.product_id = p.id
             LEFT JOIN subscriptions s ON k.id = s.key_id AND s.is_active = TRUE
             WHERE k.purchased_by = $1 OR k.redeemed_by = $1
             ORDER BY k.created_at DESC`,
            [userId]
        );

        const keys = result.rows.map(key => ({
            id: key.id,
            keyCode: key.key_code,
            productName: key.product_name,
            durationDays: key.duration_days,
            price: parseFloat(key.price),
            isRedeemed: !!key.redeemed_at,
            isExpired: key.expires_at && new Date(key.expires_at) < new Date(),
            isActive: key.is_active,
            hwidLock: key.hwid_lock,
            createdAt: key.created_at,
            redeemedAt: key.redeemed_at,
            expiresAt: key.expires_at,
            subscriptionExpiresAt: key.subscription_expires,
            redemptionIp: key.redemption_ip
        }));

        res.json({
            keys,
            total: keys.length,
            redeemed: keys.filter(k => k.isRedeemed).length,
            active: keys.filter(k => k.isRedeemed && !k.isExpired).length
        });

    } catch (error) {
        logger.error('Error fetching user keys:', error);
        res.status(500).json({
            error: 'Failed to fetch keys'
        });
    }
});

// Get user's purchase/activity history
router.get('/history', 
    authenticateToken,
    [
        query('type').optional().isIn(['all', 'purchases', 'redemptions', 'subscriptions']).withMessage('Invalid type filter'),
        query('days').optional().isInt({ min: 1, max: 365 }).withMessage('Days must be between 1 and 365'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { type = 'all', days, limit = 50, offset = 0 } = req.query;
        const pool = req.app.locals.db;
        const userId = req.user.id;

        try {
            let history = [];

            // Build date filter
            let dateFilter = '';
            let dateParams = [];
            if (days) {
                dateFilter = `AND created_at > CURRENT_TIMESTAMP - INTERVAL '${parseInt(days)} days'`;
            }

            // Get purchases
            if (type === 'all' || type === 'purchases') {
                const purchaseQuery = `
                    SELECT 'purchase' as type, pu.id, pu.amount, pu.payment_status as status,
                           pu.created_at, p.name as product_name, k.key_code,
                           'Purchased ' || p.name || ' for ' || pu.amount::text as description
                    FROM purchases pu
                    JOIN products p ON pu.product_id = p.id
                    JOIN keys k ON pu.key_id = k.id
                    WHERE pu.user_id = $1 ${dateFilter}
                `;

                const purchaseResult = await pool.query(purchaseQuery, [userId]);
                history = history.concat(purchaseResult.rows);
            }

            // Get key redemptions
            if (type === 'all' || type === 'redemptions') {
                const redemptionQuery = `
                    SELECT 'redemption' as type, k.id, NULL as amount, 'completed' as status,
                           k.redeemed_at as created_at, p.name as product_name, k.key_code,
                           'Redeemed key for ' || p.name as description
                    FROM keys k
                    JOIN products p ON k.product_id = p.id
                    WHERE k.redeemed_by = $1 AND k.redeemed_at IS NOT NULL ${dateFilter.replace('created_at', 'k.redeemed_at')}
                `;

                const redemptionResult = await pool.query(redemptionQuery, [userId]);
                history = history.concat(redemptionResult.rows);
            }

            // Get subscription events
            if (type === 'all' || type === 'subscriptions') {
                const subscriptionQuery = `
                    SELECT 'subscription' as type, s.id, NULL as amount, 
                           CASE WHEN s.is_active AND s.expires_at > CURRENT_TIMESTAMP THEN 'active' ELSE 'expired' END as status,
                           s.created_at, p.name as product_name, k.key_code,
                           'Activated subscription for ' || p.name as description
                    FROM subscriptions s
                    JOIN products p ON s.product_id = p.id
                    JOIN keys k ON s.key_id = k.id
                    WHERE s.user_id = $1 ${dateFilter.replace('created_at', 's.created_at')}
                `;

                const subscriptionResult = await pool.query(subscriptionQuery, [userId]);
                history = history.concat(subscriptionResult.rows);
            }

            // Sort by date descending
            history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            // Apply pagination
            const paginatedHistory = history.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

            res.json({
                history: paginatedHistory,
                total: history.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: history.length > parseInt(offset) + parseInt(limit)
            });

        } catch (error) {
            logger.error('Error fetching user history:', error);
            res.status(500).json({
                error: 'Failed to fetch history'
            });
        }
    }
);

// Get user statistics (for dashboard)
router.get('/stats', authenticateToken, async (req, res) => {
    const pool = req.app.locals.db;
    const userId = req.user.id;

    try {
        // Get key counts
        const keyStats = await pool.query(
            `SELECT 
                COUNT(*) as total_keys,
                COUNT(CASE WHEN redeemed_at IS NOT NULL THEN 1 END) as redeemed_keys,
                COUNT(CASE WHEN redeemed_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) THEN 1 END) as available_keys
             FROM keys 
             WHERE purchased_by = $1 OR redeemed_by = $1`,
            [userId]
        );

        // Get purchase stats
        const purchaseStats = await pool.query(
            `SELECT 
                COUNT(*) as total_purchases,
                COALESCE(SUM(amount), 0) as total_spent
             FROM purchases 
             WHERE user_id = $1 AND payment_status = 'completed'`,
            [userId]
        );

        // Get subscription info
        const subscriptionStats = await pool.query(
            `SELECT COUNT(*) as total_subscriptions,
                    COUNT(CASE WHEN is_active = TRUE AND expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_subscriptions
             FROM subscriptions 
             WHERE user_id = $1`,
            [userId]
        );

        const stats = {
            keys: {
                total: parseInt(keyStats.rows[0].total_keys),
                redeemed: parseInt(keyStats.rows[0].redeemed_keys),
                available: parseInt(keyStats.rows[0].available_keys)
            },
            purchases: {
                total: parseInt(purchaseStats.rows[0].total_purchases),
                totalSpent: parseFloat(purchaseStats.rows[0].total_spent)
            },
            subscriptions: {
                total: parseInt(subscriptionStats.rows[0].total_subscriptions),
                active: parseInt(subscriptionStats.rows[0].active_subscriptions)
            }
        };

        res.json(stats);

    } catch (error) {
        logger.error('Error fetching user stats:', error);
        res.status(500).json({
            error: 'Failed to fetch user statistics'
        });
    }
});

// Update user HWID (for desktop app integration)
router.put('/hwid',
    authenticateToken,
    auditLog('USER_HWID_UPDATE'),
    [
        body('hwid').isLength({ min: 10, max: 255 }).withMessage('Invalid HWID format')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { hwid } = req.body;
        const pool = req.app.locals.db;
        const userId = req.user.id;

        try {
            // Check if user already has this HWID
            const currentUser = await pool.query(
                'SELECT hwid FROM users WHERE id = $1',
                [userId]
            );

            if (currentUser.rows[0].hwid === hwid) {
                return res.json({
                    message: 'HWID is already set to this value'
                });
            }

            // Check if HWID is already in use by active subscription
            const hwidCheck = await pool.query(
                `SELECT COUNT(*) as count 
                 FROM subscriptions 
                 WHERE hwid = $1 AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP`,
                [hwid]
            );

            if (parseInt(hwidCheck.rows[0].count) > 0) {
                return res.status(409).json({
                    error: 'This hardware ID is already associated with an active subscription'
                });
            }

            // Update user HWID
            await pool.query(
                'UPDATE users SET hwid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [hwid, userId]
            );

            res.json({
                message: 'Hardware ID updated successfully',
                hwid: hwid
            });

        } catch (error) {
            logger.error('Error updating user HWID:', error);
            res.status(500).json({
                error: 'Failed to update hardware ID'
            });
        }
    }
);

// Admin/Staff routes for user management
router.get('/admin/all',
    authenticateToken,
    requireStaff,
    [
        query('search').optional().isLength({ max: 255 }).withMessage('Search term too long'),
        query('role').optional().isIn(['user', 'staff', 'admin']).withMessage('Invalid role filter'),
        query('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status filter'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { search, role, status, limit = 50, offset = 0 } = req.query;
        const pool = req.app.locals.db;

        try {
            let whereConditions = [];
            let queryParams = [];
            let paramCount = 1;

            // Build search conditions
            if (search) {
                whereConditions.push(`u.email ILIKE $${paramCount}`);
                queryParams.push(`%${search}%`);
                paramCount++;
            }

            if (role) {
                whereConditions.push(`u.role = $${paramCount}`);
                queryParams.push(role);
                paramCount++;
            }

            if (status === 'active') {
                whereConditions.push('u.is_active = TRUE');
            } else if (status === 'inactive') {
                whereConditions.push('u.is_active = FALSE');
            }

            const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

            // Add pagination parameters
            queryParams.push(parseInt(limit), parseInt(offset));

            const query = `
                SELECT u.id, u.email, u.role, u.email_verified, u.is_active, 
                       u.created_at, u.last_login, u.last_ip, u.hwid,
                       COUNT(DISTINCT k.id) as total_keys,
                       COUNT(DISTINCT s.id) as total_subscriptions,
                       COUNT(DISTINCT CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN s.id END) as active_subscriptions
                FROM users u
                LEFT JOIN keys k ON u.id = k.purchased_by OR u.id = k.redeemed_by
                LEFT JOIN subscriptions s ON u.id = s.user_id
                ${whereClause}
                GROUP BY u.id, u.email, u.role, u.email_verified, u.is_active, u.created_at, u.last_login, u.last_ip, u.hwid
                ORDER BY u.created_at DESC
                LIMIT $${paramCount - 1} OFFSET $${paramCount}
            `;

            const result = await pool.query(query, queryParams);

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(DISTINCT u.id) as total
                FROM users u
                ${whereClause}
            `;
            const countResult = await pool.query(countQuery, queryParams.slice(0, -2));

            const users = result.rows.map(user => ({
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.email_verified,
                isActive: user.is_active,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                lastIp: user.last_ip,
                hwid: user.hwid,
                stats: {
                    totalKeys: parseInt(user.total_keys),
                    totalSubscriptions: parseInt(user.total_subscriptions),
                    activeSubscriptions: parseInt(user.active_subscriptions)
                }
            }));

            res.json({
                users,
                pagination: {
                    total: parseInt(countResult.rows[0].total),
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: parseInt(countResult.rows[0].total) > parseInt(offset) + parseInt(limit)
                }
            });

        } catch (error) {
            logger.error('Error fetching users for admin:', error);
            res.status(500).json({
                error: 'Failed to fetch users'
            });
        }
    }
);

// Admin route to update user status
router.put('/admin/:userId/status',
    authenticateToken,
    requireAdmin,
    auditLog('ADMIN_USER_STATUS_UPDATE'),
    [
        body('isActive').isBoolean().withMessage('isActive must be a boolean'),
        body('reason').optional().isLength({ max: 500 }).withMessage('Reason too long')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { userId } = req.params;
        const { isActive, reason } = req.body;
        const pool = req.app.locals.db;

        try {
            // Check if user exists
            const userCheck = await pool.query(
                'SELECT email, role FROM users WHERE id = $1',
                [userId]
            );

            if (userCheck.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            const targetUser = userCheck.rows[0];

            // Prevent admin from deactivating themselves
            if (userId === req.user.id) {
                return res.status(400).json({
                    error: 'You cannot change your own account status'
                });
            }

            // Prevent non-admin from modifying admin users
            if (targetUser.role === 'admin' && req.user.role !== 'admin') {
                return res.status(403).json({
                    error: 'Insufficient permissions to modify admin users'
                });
            }

            // Update user status
            await pool.query(
                'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [isActive, userId]
            );

            // If deactivating, also deactivate any active subscriptions
            if (!isActive) {
                await pool.query(
                    'UPDATE subscriptions SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE',
                    [userId]
                );
            }

            res.json({
                message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
                user: {
                    id: userId,
                    email: targetUser.email,
                    isActive: isActive
                }
            });

        } catch (error) {
            logger.error('Error updating user status:', error);
            res.status(500).json({
                error: 'Failed to update user status'
            });
        }
    }
);

module.exports = router;