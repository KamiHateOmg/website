const express = require('express');
const { body, validationResult, query, param } = require('express-validator');
const { authenticateToken, requireStaff, requireAdmin, optionalAuth, auditLog } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get active subscription for HWID (used by desktop app)
router.get('/active/:hwid',
    [
        param('hwid').isLength({ min: 10, max: 255 }).withMessage('Invalid HWID format')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { hwid } = req.params;
        const pool = req.app.locals.db;

        try {
            // Use the database function to get active subscription
            const result = await pool.query(
                'SELECT * FROM get_active_subscription($1)',
                [hwid]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'No active subscription found',
                    hasActiveSubscription: false
                });
            }

            const subscription = result.rows[0];
            
            // Calculate time remaining details
            const now = new Date();
            const expiresAt = new Date(subscription.expires_at);
            const diffMs = expiresAt - now;
            const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
            const hoursRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60)));
            const minutesRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60)));

            res.json({
                hasActiveSubscription: true,
                subscription: {
                    id: subscription.subscription_id,
                    productName: subscription.product_name,
                    expiresAt: subscription.expires_at,
                    daysRemaining: daysRemaining,
                    hoursRemaining: hoursRemaining,
                    minutesRemaining: minutesRemaining,
                    isLifetime: daysRemaining > 9999, // Lifetime subscriptions
                    timeRemaining: {
                        days: Math.floor(daysRemaining),
                        hours: Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
                        minutes: Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
                    }
                }
            });

            // Log access attempt (but don't audit log since this is high-frequency)
            logger.info(`Desktop app auth check for HWID: ${hwid}, result: active subscription found`);

        } catch (error) {
            logger.error('Error checking active subscription:', error);
            res.status(500).json({
                error: 'Internal server error',
                hasActiveSubscription: false
            });
        }
    }
);

// Get all user subscriptions (for authenticated users)
router.get('/user',
    authenticateToken,
    async (req, res) => {
        const pool = req.app.locals.db;
        const userId = req.user.id;

        try {
            const result = await pool.query(
                `SELECT s.id, s.starts_at, s.expires_at, s.is_active, s.hwid, s.created_at,
                        p.name as product_name, p.duration_days, p.price,
                        k.key_code, k.redeemed_at,
                        u.email as user_email
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN keys k ON s.key_id = k.id
                 JOIN users u ON s.user_id = u.id
                 WHERE s.user_id = $1
                 ORDER BY s.created_at DESC`,
                [userId]
            );

            const subscriptions = result.rows.map(sub => {
                const now = new Date();
                const expiresAt = new Date(sub.expires_at);
                const isExpired = expiresAt < now;
                const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

                return {
                    id: sub.id,
                    productName: sub.product_name,
                    durationDays: sub.duration_days,
                    price: parseFloat(sub.price),
                    keyCode: sub.key_code,
                    hwid: sub.hwid,
                    startsAt: sub.starts_at,
                    expiresAt: sub.expires_at,
                    redeemedAt: sub.redeemed_at,
                    createdAt: sub.created_at,
                    isActive: sub.is_active && !isExpired,
                    isExpired: isExpired,
                    daysRemaining: daysRemaining,
                    isLifetime: sub.duration_days === 999999,
                    status: sub.is_active && !isExpired ? 'active' : isExpired ? 'expired' : 'inactive'
                };
            });

            res.json({
                subscriptions,
                total: subscriptions.length,
                active: subscriptions.filter(s => s.isActive).length,
                expired: subscriptions.filter(s => s.isExpired).length
            });

        } catch (error) {
            logger.error('Error fetching user subscriptions:', error);
            res.status(500).json({
                error: 'Failed to fetch subscriptions'
            });
        }
    }
);

// Get subscription details by ID
router.get('/:subscriptionId',
    authenticateToken,
    [
        param('subscriptionId').isUUID().withMessage('Invalid subscription ID')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { subscriptionId } = req.params;
        const pool = req.app.locals.db;
        const userId = req.user.id;

        try {
            const result = await pool.query(
                `SELECT s.id, s.starts_at, s.expires_at, s.is_active, s.hwid, s.created_at,
                        s.user_id, s.product_id, s.key_id,
                        p.name as product_name, p.description as product_description, 
                        p.duration_days, p.price,
                        k.key_code, k.redeemed_at, k.redemption_ip,
                        u.email as user_email
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN keys k ON s.key_id = k.id
                 JOIN users u ON s.user_id = u.id
                 WHERE s.id = $1 AND s.user_id = $2`,
                [subscriptionId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Subscription not found'
                });
            }

            const sub = result.rows[0];
            const now = new Date();
            const expiresAt = new Date(sub.expires_at);
            const isExpired = expiresAt < now;
            const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

            const subscription = {
                id: sub.id,
                productName: sub.product_name,
                productDescription: sub.product_description,
                durationDays: sub.duration_days,
                price: parseFloat(sub.price),
                keyCode: sub.key_code,
                hwid: sub.hwid,
                startsAt: sub.starts_at,
                expiresAt: sub.expires_at,
                redeemedAt: sub.redeemed_at,
                redemptionIp: sub.redemption_ip,
                createdAt: sub.created_at,
                isActive: sub.is_active && !isExpired,
                isExpired: isExpired,
                daysRemaining: daysRemaining,
                isLifetime: sub.duration_days === 999999,
                status: sub.is_active && !isExpired ? 'active' : isExpired ? 'expired' : 'inactive',
                timeRemaining: {
                    days: Math.floor(daysRemaining),
                    hours: Math.floor(((expiresAt - now) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
                    minutes: Math.floor(((expiresAt - now) % (1000 * 60 * 60)) / (1000 * 60))
                }
            };

            res.json({ subscription });

        } catch (error) {
            logger.error('Error fetching subscription details:', error);
            res.status(500).json({
                error: 'Failed to fetch subscription details'
            });
        }
    }
);

// Extend existing subscription (admin only)
router.post('/:subscriptionId/extend',
    authenticateToken,
    requireStaff,
    auditLog('SUBSCRIPTION_EXTEND'),
    [
        param('subscriptionId').isUUID().withMessage('Invalid subscription ID'),
        body('extensionDays').isInt({ min: 1, max: 3650 }).withMessage('Extension days must be between 1 and 3650'),
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

        const { subscriptionId } = req.params;
        const { extensionDays, reason } = req.body;
        const pool = req.app.locals.db;

        try {
            // Get current subscription
            const subResult = await pool.query(
                `SELECT s.*, p.name as product_name, u.email as user_email
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN users u ON s.user_id = u.id
                 WHERE s.id = $1`,
                [subscriptionId]
            );

            if (subResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Subscription not found'
                });
            }

            const subscription = subResult.rows[0];
            const currentExpiry = new Date(subscription.expires_at);
            const newExpiry = new Date(currentExpiry.getTime() + (extensionDays * 24 * 60 * 60 * 1000));

            // Update subscription expiry
            await pool.query(
                'UPDATE subscriptions SET expires_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newExpiry, subscriptionId]
            );

            // Log the extension
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, details, ip_address)
                 VALUES ($1, 'SUBSCRIPTION_EXTENDED', $2, $3)`,
                [
                    req.user.id,
                    JSON.stringify({
                        subscriptionId: subscriptionId,
                        userEmail: subscription.user_email,
                        productName: subscription.product_name,
                        extensionDays: extensionDays,
                        previousExpiry: subscription.expires_at,
                        newExpiry: newExpiry,
                        reason: reason,
                        extendedBy: req.user.email
                    }),
                    req.ip
                ]
            );

            res.json({
                message: 'Subscription extended successfully',
                subscription: {
                    id: subscriptionId,
                    productName: subscription.product_name,
                    userEmail: subscription.user_email,
                    previousExpiry: subscription.expires_at,
                    newExpiry: newExpiry,
                    extensionDays: extensionDays
                }
            });

        } catch (error) {
            logger.error('Error extending subscription:', error);
            res.status(500).json({
                error: 'Failed to extend subscription'
            });
        }
    }
);

// Deactivate subscription (admin only)
router.post('/:subscriptionId/deactivate',
    authenticateToken,
    requireStaff,
    auditLog('SUBSCRIPTION_DEACTIVATE'),
    [
        param('subscriptionId').isUUID().withMessage('Invalid subscription ID'),
        body('reason').isLength({ min: 1, max: 500 }).withMessage('Reason is required and must be under 500 characters')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { subscriptionId } = req.params;
        const { reason } = req.body;
        const pool = req.app.locals.db;

        try {
            // Get current subscription
            const subResult = await pool.query(
                `SELECT s.*, p.name as product_name, u.email as user_email
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN users u ON s.user_id = u.id
                 WHERE s.id = $1`,
                [subscriptionId]
            );

            if (subResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Subscription not found'
                });
            }

            const subscription = subResult.rows[0];

            if (!subscription.is_active) {
                return res.status(400).json({
                    error: 'Subscription is already inactive'
                });
            }

            // Deactivate subscription
            await pool.query(
                'UPDATE subscriptions SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [subscriptionId]
            );

            // Log the deactivation
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, details, ip_address)
                 VALUES ($1, 'SUBSCRIPTION_DEACTIVATED', $2, $3)`,
                [
                    req.user.id,
                    JSON.stringify({
                        subscriptionId: subscriptionId,
                        userEmail: subscription.user_email,
                        productName: subscription.product_name,
                        reason: reason,
                        deactivatedBy: req.user.email,
                        previousExpiry: subscription.expires_at
                    }),
                    req.ip
                ]
            );

            res.json({
                message: 'Subscription deactivated successfully',
                subscription: {
                    id: subscriptionId,
                    productName: subscription.product_name,
                    userEmail: subscription.user_email,
                    reason: reason
                }
            });

        } catch (error) {
            logger.error('Error deactivating subscription:', error);
            res.status(500).json({
                error: 'Failed to deactivate subscription'
            });
        }
    }
);

// Get subscription statistics (admin only)
router.get('/admin/stats',
    authenticateToken,
    requireStaff,
    [
        query('timeframe').optional().isIn(['day', 'week', 'month', 'year', 'all']).withMessage('Invalid timeframe'),
        query('productId').optional().isUUID().withMessage('Invalid product ID')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { timeframe = 'all', productId } = req.query;
        const pool = req.app.locals.db;

        try {
            // Build time filter
            let timeFilter = '';
            if (timeframe !== 'all') {
                const intervals = {
                    day: '1 day',
                    week: '7 days',
                    month: '30 days',
                    year: '365 days'
                };
                timeFilter = `AND s.created_at > CURRENT_TIMESTAMP - INTERVAL '${intervals[timeframe]}'`;
            }

            // Build product filter
            let productFilter = '';
            let productParam = [];
            if (productId) {
                productFilter = 'AND s.product_id = $1';
                productParam = [productId];
            }

            // Get overall subscription stats
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_subscriptions,
                    COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_subscriptions,
                    COUNT(CASE WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 1 END) as expired_subscriptions,
                    COUNT(CASE WHEN s.is_active = FALSE THEN 1 END) as deactivated_subscriptions,
                    COUNT(DISTINCT s.user_id) as unique_users,
                    COUNT(DISTINCT s.hwid) as unique_devices,
                    AVG(EXTRACT(DAY FROM (s.expires_at - s.starts_at))) as avg_duration_days
                FROM subscriptions s
                WHERE 1=1 ${timeFilter} ${productFilter}
            `;

            const statsResult = await pool.query(statsQuery, productParam);

            // Get subscription breakdown by product
            const productBreakdownQuery = `
                SELECT 
                    p.id, p.name, p.duration_days, p.price,
                    COUNT(s.id) as subscription_count,
                    COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_count,
                    SUM(p.price) as total_revenue
                FROM products p
                LEFT JOIN subscriptions s ON p.id = s.product_id ${timeFilter.replace('s.created_at', 's.created_at')}
                WHERE p.is_active = TRUE ${productId ? 'AND p.id = $1' : ''}
                GROUP BY p.id, p.name, p.duration_days, p.price
                ORDER BY subscription_count DESC
            `;

            const productBreakdownResult = await pool.query(productBreakdownQuery, productParam);

            // Get daily subscription creation trend (last 30 days)
            const trendQuery = `
                SELECT 
                    DATE(s.created_at) as date,
                    COUNT(*) as subscriptions_created,
                    COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_subscriptions
                FROM subscriptions s
                WHERE s.created_at > CURRENT_TIMESTAMP - INTERVAL '30 days' ${productFilter}
                GROUP BY DATE(s.created_at)
                ORDER BY date DESC
                LIMIT 30
            `;

            const trendResult = await pool.query(trendQuery, productParam);

            const stats = statsResult.rows[0];

            res.json({
                overview: {
                    totalSubscriptions: parseInt(stats.total_subscriptions),
                    activeSubscriptions: parseInt(stats.active_subscriptions),
                    expiredSubscriptions: parseInt(stats.expired_subscriptions),
                    deactivatedSubscriptions: parseInt(stats.deactivated_subscriptions),
                    uniqueUsers: parseInt(stats.unique_users),
                    uniqueDevices: parseInt(stats.unique_devices),
                    averageDurationDays: parseFloat(stats.avg_duration_days) || 0
                },
                productBreakdown: productBreakdownResult.rows.map(product => ({
                    id: product.id,
                    name: product.name,
                    durationDays: product.duration_days,
                    price: parseFloat(product.price),
                    subscriptionCount: parseInt(product.subscription_count),
                    activeCount: parseInt(product.active_count),
                    totalRevenue: parseFloat(product.total_revenue) || 0
                })),
                trend: trendResult.rows.map(day => ({
                    date: day.date,
                    subscriptionsCreated: parseInt(day.subscriptions_created),
                    activeSubscriptions: parseInt(day.active_subscriptions)
                })),
                timeframe: timeframe,
                productId: productId || null
            });

        } catch (error) {
            logger.error('Error fetching subscription statistics:', error);
            res.status(500).json({
                error: 'Failed to fetch subscription statistics'
            });
        }
    }
);

// Get all subscriptions for admin management
router.get('/admin/all',
    authenticateToken,
    requireStaff,
    [
        query('search').optional().isLength({ max: 255 }).withMessage('Search term too long'),
        query('status').optional().isIn(['active', 'expired', 'inactive', 'all']).withMessage('Invalid status filter'),
        query('productId').optional().isUUID().withMessage('Invalid product ID'),
        query('hwid').optional().isLength({ min: 10, max: 255 }).withMessage('Invalid HWID format'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
        query('sortBy').optional().isIn(['created_at', 'expires_at', 'user_email', 'product_name']).withMessage('Invalid sort field'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { 
            search, 
            status = 'all', 
            productId, 
            hwid, 
            limit = 50, 
            offset = 0, 
            sortBy = 'created_at', 
            sortOrder = 'desc' 
        } = req.query;
        const pool = req.app.locals.db;

        try {
            let whereConditions = [];
            let queryParams = [];
            let paramCount = 1;

            // Build search conditions
            if (search) {
                whereConditions.push(`(u.email ILIKE ${paramCount} OR p.name ILIKE ${paramCount} OR k.key_code ILIKE ${paramCount})`);
                queryParams.push(`%${search}%`);
                paramCount++;
            }

            if (productId) {
                whereConditions.push(`s.product_id = ${paramCount}`);
                queryParams.push(productId);
                paramCount++;
            }

            if (hwid) {
                whereConditions.push(`s.hwid = ${paramCount}`);
                queryParams.push(hwid);
                paramCount++;
            }

            // Status filtering
            if (status === 'active') {
                whereConditions.push('s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP');
            } else if (status === 'expired') {
                whereConditions.push('s.expires_at <= CURRENT_TIMESTAMP');
            } else if (status === 'inactive') {
                whereConditions.push('s.is_active = FALSE');
            }

            const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

            // Add pagination and sorting parameters
            queryParams.push(parseInt(limit), parseInt(offset));

            const query = `
                SELECT 
                    s.id, s.starts_at, s.expires_at, s.is_active, s.hwid, s.created_at,
                    s.user_id, s.product_id, s.key_id,
                    p.name as product_name, p.duration_days, p.price,
                    k.key_code, k.redeemed_at,
                    u.email as user_email, u.role as user_role,
                    CASE 
                        WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN 'active'
                        WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                        ELSE 'inactive'
                    END as status,
                    CASE 
                        WHEN s.expires_at > CURRENT_TIMESTAMP THEN EXTRACT(DAY FROM (s.expires_at - CURRENT_TIMESTAMP))
                        ELSE 0
                    END as days_remaining
                FROM subscriptions s
                JOIN products p ON s.product_id = p.id
                JOIN keys k ON s.key_id = k.id
                JOIN users u ON s.user_id = u.id
                ${whereClause}
                ORDER BY ${sortBy === 'user_email' ? 'u.email' : sortBy === 'product_name' ? 'p.name' : 's.' + sortBy} ${sortOrder.toUpperCase()}
                LIMIT ${paramCount - 1} OFFSET ${paramCount}
            `;

            const result = await pool.query(query, queryParams);

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(*) as total
                FROM subscriptions s
                JOIN products p ON s.product_id = p.id
                JOIN keys k ON s.key_id = k.id
                JOIN users u ON s.user_id = u.id
                ${whereClause}
            `;
            const countResult = await pool.query(countQuery, queryParams.slice(0, -2));

            const subscriptions = result.rows.map(sub => ({
                id: sub.id,
                userId: sub.user_id,
                userEmail: sub.user_email,
                userRole: sub.user_role,
                productId: sub.product_id,
                productName: sub.product_name,
                durationDays: sub.duration_days,
                price: parseFloat(sub.price),
                keyId: sub.key_id,
                keyCode: sub.key_code,
                hwid: sub.hwid,
                startsAt: sub.starts_at,
                expiresAt: sub.expires_at,
                redeemedAt: sub.redeemed_at,
                createdAt: sub.created_at,
                isActive: sub.is_active,
                status: sub.status,
                daysRemaining: Math.max(0, Math.floor(parseFloat(sub.days_remaining))),
                isLifetime: sub.duration_days === 999999
            }));

            res.json({
                subscriptions,
                pagination: {
                    total: parseInt(countResult.rows[0].total),
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: parseInt(countResult.rows[0].total) > parseInt(offset) + parseInt(limit)
                },
                filters: {
                    search: search || null,
                    status,
                    productId: productId || null,
                    hwid: hwid || null,
                    sortBy,
                    sortOrder
                }
            });

        } catch (error) {
            logger.error('Error fetching subscriptions for admin:', error);
            res.status(500).json({
                error: 'Failed to fetch subscriptions'
            });
        }
    }
);

// Cleanup expired subscriptions (cron job endpoint)
router.post('/admin/cleanup',
    authenticateToken,
    requireAdmin,
    auditLog('SUBSCRIPTION_CLEANUP'),
    async (req, res) => {
        const pool = req.app.locals.db;

        try {
            // Call the database function to deactivate expired subscriptions
            const result = await pool.query('SELECT deactivate_expired_subscriptions()');
            
            // Get count of cleaned up subscriptions
            const countResult = await pool.query(
                `SELECT COUNT(*) as cleaned_count 
                 FROM subscriptions 
                 WHERE is_active = FALSE AND expires_at <= CURRENT_TIMESTAMP 
                 AND updated_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'`
            );

            const cleanedCount = parseInt(countResult.rows[0].cleaned_count);

            res.json({
                message: 'Subscription cleanup completed',
                cleanedSubscriptions: cleanedCount,
                timestamp: new Date()
            });

            logger.info(`Subscription cleanup completed: ${cleanedCount} subscriptions deactivated`);

        } catch (error) {
            logger.error('Error during subscription cleanup:', error);
            res.status(500).json({
                error: 'Failed to cleanup expired subscriptions'
            });
        }
    }
);

module.exports = router;