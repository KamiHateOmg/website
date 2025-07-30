const express = require('express');
const { body, validationResult, param, query } = require('express-validator');
const { authenticateToken, requireAdmin, requireStaff, auditLog, validateHWID } = require('../middleware/auth');
const { 
    redeemKey, 
    getKeyStatus, 
    generateKeysForProduct, 
    getKeysForProduct,
    deactivateKey,
    getKeyStatistics 
} = require('../utils/keyGenerator');
const logger = require('../utils/logger');

const router = express.Router();

// Redeem a key - CORE FUNCTIONALITY
router.post('/redeem', 
    authenticateToken,
    auditLog('KEY_REDEEM_ATTEMPT'),
    [
        body('keyCode')
            .isLength({ min: 19, max: 19 })
            .matches(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
            .withMessage('Invalid key format'),
        body('hwid')
            .isLength({ min: 10, max: 255 })
            .withMessage('Invalid HWID format')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { keyCode, hwid } = req.body;
        const userId = req.user.id;
        const pool = req.app.locals.db;

        try {
            // Check if user already has an active subscription on this HWID
            const existingSubscription = await pool.query(
                `SELECT s.id, s.expires_at, p.name as product_name, u.email
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN users u ON s.user_id = u.id
                 WHERE s.hwid = $1 AND s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP`,
                [hwid]
            );

            if (existingSubscription.rows.length > 0) {
                const existing = existingSubscription.rows[0];
                const isOwnSubscription = existing.email === req.user.email;
                
                return res.status(409).json({
                    error: 'Device already has an active subscription',
                    details: {
                        productName: existing.product_name,
                        expiresAt: existing.expires_at,
                        isOwn: isOwnSubscription,
                        ownerEmail: isOwnSubscription ? existing.email : existing.email.replace(/(.{2}).*(@.*)/, '$1***$2')
                    }
                });
            }

            // Attempt to redeem the key
            const redemptionResult = await redeemKey(pool, keyCode, userId, hwid, req.ip);

            res.json({
                success: true,
                message: 'Key redeemed successfully!',
                subscription: redemptionResult.subscription,
                key: redemptionResult.key
            });

        } catch (error) {
            logger.error('Key redemption error:', error);
            
            // Handle specific redemption errors
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'Invalid key code',
                    message: 'The key you entered does not exist or is invalid.'
                });
            } else if (error.message.includes('already redeemed')) {
                // Extract email from error message if available
                const emailMatch = error.message.match(/by (.+)$/);
                const redeemedBy = emailMatch ? emailMatch[1] : 'another user';
                
                return res.status(409).json({
                    error: 'Key already redeemed',
                    message: `This key has already been redeemed by ${redeemedBy}.`,
                    redeemedBy: redeemedBy
                });
            } else if (error.message.includes('expired')) {
                return res.status(410).json({
                    error: 'Key expired',
                    message: 'This key has expired and can no longer be redeemed.'
                });
            } else if (error.message.includes('not active')) {
                return res.status(403).json({
                    error: 'Key not active',
                    message: 'This key has been deactivated and cannot be redeemed.'
                });
            } else {
                return res.status(500).json({
                    error: 'Redemption failed',
                    message: 'An error occurred while redeeming your key. Please try again.'
                });
            }
        }
    }
);

// Check key status (public endpoint with rate limiting)
router.get('/status/:keyCode',
    [
        param('keyCode')
            .isLength({ min: 19, max: 19 })
            .matches(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
            .withMessage('Invalid key format')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { keyCode } = req.params;
        const pool = req.app.locals.db;

        try {
            const keyStatus = await getKeyStatus(pool, keyCode);
            res.json(keyStatus);
        } catch (error) {
            logger.error('Key status check error:', error);
            res.status(500).json({
                error: 'Failed to check key status'
            });
        }
    }
);

// Get user's keys
router.get('/user',
    authenticateToken,
    [
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('status').optional().isIn(['all', 'unredeemed', 'redeemed', 'expired']).withMessage('Invalid status filter')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || 'all';
        const offset = (page - 1) * limit;
        const pool = req.app.locals.db;

        try {
            // Build WHERE clause based on status filter
            let whereClause = 'WHERE (k.purchased_by = $1 OR k.redeemed_by = $1)';
            let params = [userId];
            let paramCount = 1;

            if (status === 'unredeemed') {
                whereClause += ' AND k.redeemed_by IS NULL AND k.is_active = TRUE AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP)';
            } else if (status === 'redeemed') {
                whereClause += ' AND k.redeemed_by IS NOT NULL';
            } else if (status === 'expired') {
                whereClause += ' AND k.expires_at IS NOT NULL AND k.expires_at <= CURRENT_TIMESTAMP AND k.redeemed_by IS NULL';
            }

            // Get total count
            const countQuery = `
                SELECT COUNT(*) as total 
                FROM keys k 
                JOIN products p ON k.product_id = p.id 
                ${whereClause}
            `;
            
            const countResult = await pool.query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            // Get keys with pagination
            params.push(limit, offset);
            const keysQuery = `
                SELECT 
                    k.id,
                    k.key_code,
                    k.redeemed_by,
                    k.redeemed_at,
                    k.expires_at,
                    k.is_active,
                    k.created_at,
                    k.hwid_lock,
                    p.name as product_name,
                    p.duration_days,
                    p.price,
                    CASE 
                        WHEN k.redeemed_by IS NOT NULL THEN 'redeemed'
                        WHEN k.expires_at IS NOT NULL AND k.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                        WHEN k.is_active = FALSE THEN 'inactive'
                        ELSE 'unredeemed'
                    END as status,
                    s.expires_at as subscription_expires
                FROM keys k
                JOIN products p ON k.product_id = p.id
                LEFT JOIN subscriptions s ON k.id = s.key_id AND s.is_active = TRUE
                ${whereClause}
                ORDER BY k.created_at DESC
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;

            const keysResult = await pool.query(keysQuery, params);

            const keys = keysResult.rows.map(key => ({
                id: key.id,
                keyCode: key.key_code,
                productName: key.product_name,
                durationDays: key.duration_days,
                price: key.price,
                status: key.status,
                isRedeemed: !!key.redeemed_by,
                redeemedAt: key.redeemed_at,
                subscriptionExpires: key.subscription_expires,
                expiresAt: key.expires_at,
                isActive: key.is_active,
                createdAt: key.created_at,
                hwidLock: key.hwid_lock,
                isOwn: key.redeemed_by === userId || key.purchased_by === userId
            }));

            res.json({
                keys,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                    hasNextPage: page < Math.ceil(total / limit),
                    hasPrevPage: page > 1
                },
                summary: {
                    total,
                    unredeemed: keys.filter(k => k.status === 'unredeemed').length,
                    redeemed: keys.filter(k => k.status === 'redeemed').length,
                    expired: keys.filter(k => k.status === 'expired').length
                }
            });

        } catch (error) {
            logger.error('Error fetching user keys:', error);
            res.status(500).json({
                error: 'Failed to fetch keys'
            });
        }
    }
);

// Get user's active subscription
router.get('/subscription',
    authenticateToken,
    [
        query('hwid').optional().isLength({ min: 10, max: 255 }).withMessage('Invalid HWID format')
    ],
    async (req, res) => {
        const userId = req.user.id;
        const hwid = req.query.hwid;
        const pool = req.app.locals.db;

        try {
            let query = `
                SELECT 
                    s.id,
                    s.hwid,
                    s.starts_at,
                    s.expires_at,
                    s.is_active,
                    s.created_at,
                    p.name as product_name,
                    p.duration_days,
                    p.price,
                    k.key_code,
                    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400 as days_remaining,
                    CASE 
                        WHEN s.expires_at > CURRENT_TIMESTAMP THEN 'active'
                        ELSE 'expired'
                    END as status
                FROM subscriptions s
                JOIN products p ON s.product_id = p.id
                JOIN keys k ON s.key_id = k.id
                WHERE s.user_id = $1 AND s.is_active = TRUE
            `;
            
            let params = [userId];
            
            if (hwid) {
                query += ' AND s.hwid = $2';
                params.push(hwid);
            }
            
            query += ' ORDER BY s.expires_at DESC LIMIT 1';

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return res.json({
                    hasActiveSubscription: false,
                    subscription: null
                });
            }

            const subscription = result.rows[0];
            const isExpired = new Date() >= new Date(subscription.expires_at);

            // If subscription is expired, deactivate it
            if (isExpired && subscription.is_active) {
                await pool.query(
                    'UPDATE subscriptions SET is_active = FALSE WHERE id = $1',
                    [subscription.id]
                );
                
                return res.json({
                    hasActiveSubscription: false,
                    subscription: null,
                    message: 'Subscription has expired'
                });
            }

            res.json({
                hasActiveSubscription: true,
                subscription: {
                    id: subscription.id,
                    productName: subscription.product_name,
                    durationDays: subscription.duration_days,
                    hwid: subscription.hwid,
                    startsAt: subscription.starts_at,
                    expiresAt: subscription.expires_at,
                    createdAt: subscription.created_at,
                    keyCode: subscription.key_code,
                    daysRemaining: Math.max(0, Math.ceil(subscription.days_remaining)),
                    status: subscription.status,
                    isLifetime: subscription.duration_days === 999999,
                    timeRemaining: {
                        days: Math.floor(Math.max(0, subscription.days_remaining)),
                        hours: Math.floor((Math.max(0, subscription.days_remaining) % 1) * 24),
                        minutes: Math.floor(((Math.max(0, subscription.days_remaining) % 1) * 24 % 1) * 60)
                    }
                }
            });

        } catch (error) {
            logger.error('Error fetching user subscription:', error);
            res.status(500).json({
                error: 'Failed to fetch subscription'
            });
        }
    }
);

// Admin: Generate keys for a product
router.post('/admin/generate',
    authenticateToken,
    requireStaff,
    auditLog('ADMIN_GENERATE_KEYS'),
    [
        body('productId').isUUID().withMessage('Invalid product ID'),
        body('quantity').isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000'),
        body('expiresAt').optional().isISO8601().withMessage('Invalid expiration date')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { productId, quantity, expiresAt } = req.body;
        const generatedBy = req.user.id;
        const pool = req.app.locals.db;

        try {
            // Verify product exists
            const productResult = await pool.query(
                'SELECT id, name, is_active FROM products WHERE id = $1',
                [productId]
            );

            if (productResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            const product = productResult.rows[0];
            if (!product.is_active) {
                return res.status(400).json({
                    error: 'Cannot generate keys for inactive product'
                });
            }

            // Generate keys
            const expirationDate = expiresAt ? new Date(expiresAt) : null;
            const keys = await generateKeysForProduct(pool, productId, quantity, generatedBy, expirationDate);

            res.json({
                success: true,
                message: `Generated ${quantity} keys for ${product.name}`,
                keys: keys.map(key => ({
                    id: key.id,
                    keyCode: key.keyCode,
                    createdAt: key.createdAt,
                    expiresAt: key.expiresAt
                })),
                summary: {
                    productName: product.name,
                    quantity: keys.length,
                    generatedBy: req.user.email,
                    expiresAt: expirationDate
                }
            });

        } catch (error) {
            logger.error('Key generation error:', error);
            res.status(500).json({
                error: 'Failed to generate keys'
            });
        }
    }
);

// Admin: Get keys for a product
router.get('/admin/product/:productId',
    authenticateToken,
    requireStaff,
    [
        param('productId').isUUID().withMessage('Invalid product ID'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('status').optional().isIn(['all', 'available', 'redeemed', 'expired']).withMessage('Invalid status filter')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { productId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status || 'all';
        const pool = req.app.locals.db;

        try {
            const result = await getKeysForProduct(pool, productId, page, limit, status);
            res.json(result);
        } catch (error) {
            logger.error('Error fetching product keys:', error);
            res.status(500).json({
                error: 'Failed to fetch product keys'
            });
        }
    }
);

// Admin: Deactivate a key
router.patch('/admin/:keyId/deactivate',
    authenticateToken,
    requireStaff,
    auditLog('ADMIN_DEACTIVATE_KEY'),
    [
        param('keyId').isUUID().withMessage('Invalid key ID')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { keyId } = req.params;
        const adminId = req.user.id;
        const pool = req.app.locals.db;

        try {
            const success = await deactivateKey(pool, keyId, adminId);
            
            if (success) {
                res.json({
                    success: true,
                    message: 'Key deactivated successfully'
                });
            } else {
                res.status(404).json({
                    error: 'Key not found or already redeemed'
                });
            }
        } catch (error) {
            logger.error('Key deactivation error:', error);
            res.status(500).json({
                error: 'Failed to deactivate key'
            });
        }
    }
);

// Admin: Get key statistics
router.get('/admin/statistics',
    authenticateToken,
    requireStaff,
    [
        query('productId').optional().isUUID().withMessage('Invalid product ID')
    ],
    async (req, res) => {
        const { productId } = req.query;
        const pool = req.app.locals.db;

        try {
            const stats = await getKeyStatistics(pool, productId || null);
            res.json(stats);
        } catch (error) {
            logger.error('Error getting key statistics:', error);
            res.status(500).json({
                error: 'Failed to get key statistics'
            });
        }
    }
);

// Desktop app: Check subscription by HWID (no auth required, rate limited)
router.get('/desktop/subscription/:hwid',
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
            
            // Log access attempt for security monitoring
            await pool.query(
                'INSERT INTO audit_logs (action, details, ip_address) VALUES ($1, $2, $3)',
                ['DESKTOP_AUTH_CHECK', JSON.stringify({ hwid, success: true }), req.ip]
            );

            res.json({
                hasActiveSubscription: true,
                productName: subscription.product_name,
                expiresAt: subscription.expires_at,
                daysRemaining: subscription.days_remaining,
                timeRemaining: {
                    days: Math.floor(subscription.days_remaining),
                    hours: Math.floor((subscription.days_remaining % 1) * 24),
                    minutes: Math.floor(((subscription.days_remaining % 1) * 24 % 1) * 60)
                }
            });

        } catch (error) {
            logger.error('Desktop subscription check error:', error);
            
            // Log failed attempt
            await pool.query(
                'INSERT INTO audit_logs (action, details, ip_address) VALUES ($1, $2, $3)',
                ['DESKTOP_AUTH_CHECK', JSON.stringify({ hwid, success: false, error: error.message }), req.ip]
            ).catch(() => {}); // Don't fail if audit log fails

            res.status(500).json({
                error: 'Internal server error',
                hasActiveSubscription: false
            });
        }
    }
);

// Health check endpoint for monitoring
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'key-management',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;