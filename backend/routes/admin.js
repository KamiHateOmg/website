const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { authenticateToken, requireStaff, requireAdmin, auditLog } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Admin dashboard statistics
router.get('/dashboard', authenticateToken, requireStaff, async (req, res) => {
    const pool = req.app.locals.db;

    try {
        // Get overview statistics
        const overviewStats = await Promise.all([
            // Total users
            pool.query('SELECT COUNT(*) as count FROM users'),
            // Active users (logged in last 30 days)
            pool.query('SELECT COUNT(*) as count FROM users WHERE last_login > CURRENT_TIMESTAMP - INTERVAL \'30 days\''),
            // Total products
            pool.query('SELECT COUNT(*) as count FROM products WHERE is_active = TRUE'),
            // Total keys
            pool.query('SELECT COUNT(*) as count FROM keys'),
            // Redeemed keys
            pool.query('SELECT COUNT(*) as count FROM keys WHERE redeemed_at IS NOT NULL'),
            // Active subscriptions
            pool.query('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = TRUE AND expires_at > CURRENT_TIMESTAMP'),
            // Total revenue
            pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM purchases WHERE payment_status = \'completed\'')
        ]);

        // Get recent activity (last 100 audit logs)
        const recentActivity = await pool.query(`
            SELECT al.action, al.details, al.ip_address, al.created_at,
                   u.email as user_email, u.role as user_role
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC
            LIMIT 100
        `);

        // Get system health metrics
        const systemHealth = await Promise.all([
            // Database connection count
            pool.query('SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = \'active\''),
            // Failed login attempts in last hour
            pool.query('SELECT COUNT(*) as count FROM login_attempts WHERE success = FALSE AND created_at > CURRENT_TIMESTAMP - INTERVAL \'1 hour\''),
            // Expired subscriptions needing cleanup
            pool.query('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = TRUE AND expires_at <= CURRENT_TIMESTAMP')
        ]);

        // Get user registrations trend (last 30 days)
        const userTrend = await pool.query(`
            SELECT DATE(created_at) as date, COUNT(*) as registrations
            FROM users
            WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 30
        `);

        // Get revenue trend (last 30 days)
        const revenueTrend = await pool.query(`
            SELECT DATE(created_at) as date, COALESCE(SUM(amount), 0) as revenue
            FROM purchases
            WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days' 
            AND payment_status = 'completed'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 30
        `);

        // Get top products by sales
        const topProducts = await pool.query(`
            SELECT p.name, p.price, COUNT(pu.id) as sales_count, 
                   COALESCE(SUM(pu.amount), 0) as total_revenue
            FROM products p
            LEFT JOIN purchases pu ON p.id = pu.product_id AND pu.payment_status = 'completed'
            WHERE p.is_active = TRUE
            GROUP BY p.id, p.name, p.price
            ORDER BY sales_count DESC, total_revenue DESC
            LIMIT 10
        `);

        res.json({
            overview: {
                totalUsers: parseInt(overviewStats[0].rows[0].count),
                activeUsers: parseInt(overviewStats[1].rows[0].count),
                totalProducts: parseInt(overviewStats[2].rows[0].count),
                totalKeys: parseInt(overviewStats[3].rows[0].count),
                redeemedKeys: parseInt(overviewStats[4].rows[0].count),
                activeSubscriptions: parseInt(overviewStats[5].rows[0].count),
                totalRevenue: parseFloat(overviewStats[6].rows[0].total)
            },
            systemHealth: {
                activeConnections: parseInt(systemHealth[0].rows[0].active_connections),
                failedLogins: parseInt(systemHealth[1].rows[0].count),
                expiredSubscriptions: parseInt(systemHealth[2].rows[0].count),
                status: 'healthy' // You can implement more sophisticated health checks
            },
            trends: {
                userRegistrations: userTrend.rows.map(row => ({
                    date: row.date,
                    count: parseInt(row.registrations)
                })),
                revenue: revenueTrend.rows.map(row => ({
                    date: row.date,
                    amount: parseFloat(row.revenue)
                }))
            },
            topProducts: topProducts.rows.map(row => ({
                name: row.name,
                price: parseFloat(row.price),
                salesCount: parseInt(row.sales_count),
                totalRevenue: parseFloat(row.total_revenue)
            })),
            recentActivity: recentActivity.rows.slice(0, 20).map(log => ({
                action: log.action,
                details: log.details,
                userEmail: log.user_email,
                userRole: log.user_role,
                ipAddress: log.ip_address,
                timestamp: log.created_at
            }))
        });

    } catch (error) {
        logger.error('Error fetching admin dashboard data:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard data'
        });
    }
});

// Get system logs with filtering
router.get('/logs',
    authenticateToken,
    requireStaff,
    [
        query('action').optional().isLength({ max: 100 }).withMessage('Action filter too long'),
        query('userId').optional().isUUID().withMessage('Invalid user ID'),
        query('days').optional().isInt({ min: 1, max: 365 }).withMessage('Days must be between 1 and 365'),
        query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
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

        const { action, userId, days, limit = 100, offset = 0 } = req.query;
        const pool = req.app.locals.db;

        try {
            let whereConditions = [];
            let queryParams = [];
            let paramCount = 1;

            // Build filters
            if (action) {
                whereConditions.push(`al.action ILIKE ${paramCount}`);
                queryParams.push(`%${action}%`);
                paramCount++;
            }

            if (userId) {
                whereConditions.push(`al.user_id = ${paramCount}`);
                queryParams.push(userId);
                paramCount++;
            }

            if (days) {
                whereConditions.push(`al.created_at > CURRENT_TIMESTAMP - INTERVAL '${parseInt(days)} days'`);
            }

            const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

            // Add pagination parameters
            queryParams.push(parseInt(limit), parseInt(offset));

            const query = `
                SELECT al.id, al.action, al.details, al.ip_address, al.user_agent, al.created_at,
                       u.email as user_email, u.role as user_role
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                ${whereClause}
                ORDER BY al.created_at DESC
                LIMIT ${paramCount - 1} OFFSET ${paramCount}
            `;

            const result = await pool.query(query, queryParams);

            // Get total count
            const countQuery = `
                SELECT COUNT(*) as total
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                ${whereClause}
            `;
            const countResult = await pool.query(countQuery, queryParams.slice(0, -2));

            res.json({
                logs: result.rows.map(log => ({
                    id: log.id,
                    action: log.action,
                    details: log.details,
                    userEmail: log.user_email || 'System',
                    userRole: log.user_role || 'system',
                    ipAddress: log.ip_address,
                    userAgent: log.user_agent,
                    timestamp: log.created_at
                })),
                pagination: {
                    total: parseInt(countResult.rows[0].total),
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: parseInt(countResult.rows[0].total) > parseInt(offset) + parseInt(limit)
                }
            });

        } catch (error) {
            logger.error('Error fetching system logs:', error);
            res.status(500).json({
                error: 'Failed to fetch system logs'
            });
        }
    }
);

// Bulk key generation
router.post('/keys/generate',
    authenticateToken,
    requireStaff,
    auditLog('ADMIN_BULK_KEY_GENERATION'),
    [
        body('productId').isUUID().withMessage('Valid product ID is required'),
        body('quantity').isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000'),
        body('expiresInDays').optional().isInt({ min: 1, max: 365 }).withMessage('Expiry must be between 1 and 365 days'),
        body('description').optional().isLength({ max: 500 }).withMessage('Description too long')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { productId, quantity, expiresInDays, description } = req.body;
        const pool = req.app.locals.db;

        try {
            // Verify product exists
            const productResult = await pool.query(
                'SELECT name, is_active FROM products WHERE id = $1',
                [productId]
            );

            if (productResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            if (!productResult.rows[0].is_active) {
                return res.status(400).json({
                    error: 'Cannot generate keys for inactive product'
                });
            }

            const productName = productResult.rows[0].name;

            // Use the key generator utility
            const { generateKeysForProduct } = require('../utils/keyGenerator');
            
            const keys = await generateKeysForProduct(
                pool, 
                productId, 
                quantity, 
                req.user.id, 
                expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null
            );

            res.json({
                message: `Successfully generated ${quantity} keys for ${productName}`,
                keys: keys.map(key => ({
                    id: key.id,
                    keyCode: key.keyCode,
                    productName: productName,
                    expiresAt: key.expiresAt,
                    createdAt: key.createdAt
                })),
                summary: {
                    productId: productId,
                    productName: productName,
                    quantity: quantity,
                    generatedBy: req.user.email,
                    expiresInDays: expiresInDays || 'Never',
                    description: description || null
                }
            });

        } catch (error) {
            logger.error('Error generating bulk keys:', error);
            res.status(500).json({
                error: 'Failed to generate keys'
            });
        }
    }
);

// Get key statistics for admin
router.get('/keys/stats',
    authenticateToken,
    requireStaff,
    [
        query('productId').optional().isUUID().withMessage('Invalid product ID'),
        query('timeframe').optional().isIn(['day', 'week', 'month', 'year', 'all']).withMessage('Invalid timeframe')
    ],
    async (req, res) => {
        const { productId, timeframe = 'all' } = req.query;
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
                timeFilter = `AND k.created_at > CURRENT_TIMESTAMP - INTERVAL '${intervals[timeframe]}'`;
            }

            // Build product filter
            let productFilter = '';
            let productParam = [];
            if (productId) {
                productFilter = 'AND k.product_id = $1';
                productParam = [productId];
            }

            // Get overall key statistics
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_keys,
                    COUNT(CASE WHEN k.redeemed_at IS NOT NULL THEN 1 END) as redeemed_keys,
                    COUNT(CASE WHEN k.redeemed_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP) THEN 1 END) as available_keys,
                    COUNT(CASE WHEN k.expires_at IS NOT NULL AND k.expires_at <= CURRENT_TIMESTAMP THEN 1 END) as expired_keys,
                    COUNT(CASE WHEN k.purchased_by IS NOT NULL THEN 1 END) as purchased_keys,
                    COUNT(DISTINCT k.generated_by) as generators_count,
                    COUNT(DISTINCT k.hwid_lock) as unique_devices
                FROM keys k
                WHERE k.is_active = TRUE ${timeFilter} ${productFilter}
            `;

            const statsResult = await pool.query(statsQuery, productParam);

            // Get key breakdown by product
            const productBreakdownQuery = `
                SELECT 
                    p.id, p.name, p.duration_days, p.price,
                    COUNT(k.id) as total_keys,
                    COUNT(CASE WHEN k.redeemed_at IS NOT NULL THEN 1 END) as redeemed_keys,
                    COUNT(CASE WHEN k.redeemed_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP) THEN 1 END) as available_keys
                FROM products p
                LEFT JOIN keys k ON p.id = k.product_id AND k.is_active = TRUE ${timeFilter.replace('k.created_at', 'k.created_at')}
                WHERE p.is_active = TRUE ${productId ? 'AND p.id = $1' : ''}
                GROUP BY p.id, p.name, p.duration_days, p.price
                ORDER BY total_keys DESC
            `;

            const productBreakdownResult = await pool.query(productBreakdownQuery, productParam);

            // Get recent key activity
            const recentActivityQuery = `
                SELECT k.key_code, k.created_at, k.redeemed_at, k.hwid_lock,
                       p.name as product_name,
                       u_gen.email as generated_by_email,
                       u_purch.email as purchased_by_email,
                       u_red.email as redeemed_by_email
                FROM keys k
                JOIN products p ON k.product_id = p.id
                LEFT JOIN users u_gen ON k.generated_by = u_gen.id
                LEFT JOIN users u_purch ON k.purchased_by = u_purch.id
                LEFT JOIN users u_red ON k.redeemed_by = u_red.id
                WHERE k.is_active = TRUE ${timeFilter} ${productFilter}
                ORDER BY k.created_at DESC
                LIMIT 50
            `;

            const recentActivityResult = await pool.query(recentActivityQuery, productParam);

            const stats = statsResult.rows[0];

            res.json({
                overview: {
                    totalKeys: parseInt(stats.total_keys),
                    redeemedKeys: parseInt(stats.redeemed_keys),
                    availableKeys: parseInt(stats.available_keys),
                    expiredKeys: parseInt(stats.expired_keys),
                    purchasedKeys: parseInt(stats.purchased_keys),
                    generatorsCount: parseInt(stats.generators_count),
                    uniqueDevices: parseInt(stats.unique_devices),
                    redemptionRate: stats.total_keys > 0 ? (stats.redeemed_keys / stats.total_keys * 100).toFixed(2) : 0
                },
                productBreakdown: productBreakdownResult.rows.map(product => ({
                    id: product.id,
                    name: product.name,
                    durationDays: product.duration_days,
                    price: parseFloat(product.price),
                    totalKeys: parseInt(product.total_keys),
                    redeemedKeys: parseInt(product.redeemed_keys),
                    availableKeys: parseInt(product.available_keys),
                    redemptionRate: product.total_keys > 0 ? (product.redeemed_keys / product.total_keys * 100).toFixed(2) : 0
                })),
                recentActivity: recentActivityResult.rows.map(key => ({
                    keyCode: key.key_code,
                    productName: key.product_name,
                    createdAt: key.created_at,
                    redeemedAt: key.redeemed_at,
                    hwidLock: key.hwid_lock,
                    generatedBy: key.generated_by_email,
                    purchasedBy: key.purchased_by_email,
                    redeemedBy: key.redeemed_by_email,
                    status: key.redeemed_at ? 'redeemed' : 'available'
                })),
                timeframe: timeframe,
                productId: productId || null
            });

        } catch (error) {
            logger.error('Error fetching key statistics:', error);
            res.status(500).json({
                error: 'Failed to fetch key statistics'
            });
        }
    }
);

// System maintenance operations
router.post('/maintenance/cleanup',
    authenticateToken,
    requireAdmin,
    auditLog('ADMIN_SYSTEM_CLEANUP'),
    [
        body('operations').isArray().withMessage('Operations must be an array'),
        body('operations.*').isIn(['expired_subscriptions', 'old_logs', 'unused_keys', 'failed_logins']).withMessage('Invalid operation type')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { operations } = req.body;
        const pool = req.app.locals.db;
        const results = {};

        try {
            for (const operation of operations) {
                switch (operation) {
                    case 'expired_subscriptions':
                        await pool.query('SELECT deactivate_expired_subscriptions()');
                        const expiredCount = await pool.query(
                            'SELECT COUNT(*) as count FROM subscriptions WHERE is_active = FALSE AND expires_at <= CURRENT_TIMESTAMP'
                        );
                        results.expiredSubscriptions = {
                            cleaned: parseInt(expiredCount.rows[0].count),
                            message: 'Expired subscriptions deactivated'
                        };
                        break;

                    case 'old_logs':
                        const oldLogsResult = await pool.query(
                            'DELETE FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL \'90 days\' RETURNING *'
                        );
                        results.oldLogs = {
                            cleaned: oldLogsResult.rowCount,
                            message: 'Audit logs older than 90 days deleted'
                        };
                        break;

                    case 'unused_keys':
                        const unusedKeysResult = await pool.query(
                            `UPDATE keys SET is_active = FALSE 
                             WHERE expires_at < CURRENT_TIMESTAMP 
                             AND redeemed_at IS NULL 
                             AND is_active = TRUE 
                             RETURNING *`
                        );
                        results.unusedKeys = {
                            cleaned: unusedKeysResult.rowCount,
                            message: 'Expired unused keys deactivated'
                        };
                        break;

                    case 'failed_logins':
                        const failedLoginsResult = await pool.query(
                            'DELETE FROM login_attempts WHERE created_at < CURRENT_TIMESTAMP - INTERVAL \'7 days\' RETURNING *'
                        );
                        results.failedLogins = {
                            cleaned: failedLoginsResult.rowCount,
                            message: 'Login attempts older than 7 days deleted'
                        };
                        break;
                }
            }

            res.json({
                message: 'System cleanup completed',
                operations: operations,
                results: results,
                performedBy: req.user.email,
                timestamp: new Date()
            });

            logger.info(`System cleanup performed by ${req.user.email}:`, results);

        } catch (error) {
            logger.error('Error during system cleanup:', error);
            res.status(500).json({
                error: 'System cleanup failed',
                completedOperations: Object.keys(results)
            });
        }
    }
);

// Export user data (GDPR compliance)
router.get('/users/:userId/export',
    authenticateToken,
    requireStaff,
    auditLog('ADMIN_USER_DATA_EXPORT'),
    [
        param('userId').isUUID().withMessage('Invalid user ID')
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
        const pool = req.app.locals.db;

        try {
            // Get user data
            const userData = await pool.query(
                'SELECT * FROM users WHERE id = $1',
                [userId]
            );

            if (userData.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            // Get user's keys
            const keysData = await pool.query(
                `SELECT k.*, p.name as product_name 
                 FROM keys k 
                 JOIN products p ON k.product_id = p.id 
                 WHERE k.purchased_by = $1 OR k.redeemed_by = $1`,
                [userId]
            );

            // Get user's subscriptions
            const subscriptionsData = await pool.query(
                `SELECT s.*, p.name as product_name 
                 FROM subscriptions s 
                 JOIN products p ON s.product_id = p.id 
                 WHERE s.user_id = $1`,
                [userId]
            );

            // Get user's purchases
            const purchasesData = await pool.query(
                `SELECT pu.*, p.name as product_name 
                 FROM purchases pu 
                 JOIN products p ON pu.product_id = p.id 
                 WHERE pu.user_id = $1`,
                [userId]
            );

            // Get user's audit logs
            const auditData = await pool.query(
                'SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC',
                [userId]
            );

            const exportData = {
                user: userData.rows[0],
                keys: keysData.rows,
                subscriptions: subscriptionsData.rows,
                purchases: purchasesData.rows,
                auditLogs: auditData.rows,
                exportedAt: new Date(),
                exportedBy: req.user.email
            };

            // Remove sensitive fields
            delete exportData.user.password_hash;
            delete exportData.user.password_reset_token;
            delete exportData.user.email_verification_token;

            res.json({
                message: 'User data exported successfully',
                data: exportData
            });

        } catch (error) {
            logger.error('Error exporting user data:', error);
            res.status(500).json({
                error: 'Failed to export user data'
            });
        }
    }
);

// System health check
router.get('/health',
    authenticateToken,
    requireStaff,
    async (req, res) => {
        const pool = req.app.locals.db;

        try {
            const healthChecks = await Promise.all([
                // Database connectivity
                pool.query('SELECT 1'),
                // Check for locked subscriptions
                pool.query('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = TRUE AND expires_at <= CURRENT_TIMESTAMP'),
                // Check for pending cleanups
                pool.query('SELECT COUNT(*) as count FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL \'90 days\''),
                // Check system load (connection count)
                pool.query('SELECT count(*) as connections FROM pg_stat_activity'),
                // Check for recent errors
                pool.query('SELECT COUNT(*) as count FROM login_attempts WHERE success = FALSE AND created_at > CURRENT_TIMESTAMP - INTERVAL \'1 hour\'')
            ]);

            const expiredSubs = parseInt(healthChecks[1].rows[0].count);
            const oldLogs = parseInt(healthChecks[2].rows[0].count);
            const connections = parseInt(healthChecks[3].rows[0].connections);
            const recentFailures = parseInt(healthChecks[4].rows[0].count);

            const issues = [];
            if (expiredSubs > 0) issues.push(`${expiredSubs} expired subscriptions need cleanup`);
            if (oldLogs > 1000) issues.push(`${oldLogs} old audit logs can be cleaned`);
            if (connections > 100) issues.push(`High database connection count: ${connections}`);
            if (recentFailures > 50) issues.push(`High login failure rate: ${recentFailures} in last hour`);

            const status = issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'warning' : 'critical';

            res.json({
                status: status,
                timestamp: new Date(),
                checks: {
                    database: 'connected',
                    expiredSubscriptions: expiredSubs,
                    oldAuditLogs: oldLogs,
                    activeConnections: connections,
                    recentLoginFailures: recentFailures
                },
                issues: issues,
                recommendations: issues.length > 0 ? [
                    'Run system cleanup to resolve issues',
                    'Monitor system performance',
                    'Review security logs for suspicious activity'
                ] : []
            });

        } catch (error) {
            logger.error('Error checking system health:', error);
            res.status(500).json({
                status: 'error',
                error: 'Health check failed',
                timestamp: new Date()
            });
        }
    }
);

module.exports = router;