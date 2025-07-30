const { 
    redeemKey, 
    getKeyStatus, 
    generateKeysForProduct, 
    getKeysForProduct,
    deactivateKey,
    getKeyStatistics 
} = require('../utils/keyGenerator');
const logger = require('../utils/logger');

/**
 * Redeem a key for a user
 */
const redeemUserKey = async (pool, keyCode, userId, hwid, ip) => {
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
            const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            const isOwnSubscription = existing.email === userResult.rows[0]?.email;
            
            throw new Error('Device already has an active subscription', {
                details: {
                    productName: existing.product_name,
                    expiresAt: existing.expires_at,
                    isOwn: isOwnSubscription,
                    ownerEmail: isOwnSubscription ? existing.email : existing.email.replace(/(.{2}).*(@.*)/, '$1***$2')
                }
            });
        }

        // Attempt to redeem the key
        const redemptionResult = await redeemKey(pool, keyCode, userId, hwid, ip);

        return {
            success: true,
            message: 'Key redeemed successfully!',
            subscription: redemptionResult.subscription,
            key: redemptionResult.key
        };
    } catch (error) {
        logger.error('Key redemption error:', error);
        throw error;
    }
};

/**
 * Check key status (public endpoint)
 */
const checkKeyStatus = async (pool, keyCode) => {
    try {
        return await getKeyStatus(pool, keyCode);
    } catch (error) {
        logger.error('Key status check error:', error);
        throw new Error('Failed to check key status');
    }
};

/**
 * Get user's keys with pagination and filtering
 */
const getUserKeys = async (pool, userId, filters) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = filters;
        const offset = (page - 1) * limit;

        // Build WHERE clause based on status filter
        let whereClause = 'WHERE (k.purchased_by = $1 OR k.redeemed_by = $1)';
        let params = [userId];

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
                k.purchased_by,
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
            LIMIT $${params.length - 1} OFFSET $${params.length}
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

        return {
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
        };
    } catch (error) {
        logger.error('Error fetching user keys:', error);
        throw new Error('Failed to fetch keys');
    }
};

/**
 * Get user's active subscription
 */
const getUserSubscription = async (pool, userId, hwid = null) => {
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
            return {
                hasActiveSubscription: false,
                subscription: null
            };
        }

        const subscription = result.rows[0];
        const isExpired = new Date() >= new Date(subscription.expires_at);

        // If subscription is expired, deactivate it
        if (isExpired && subscription.is_active) {
            await pool.query(
                'UPDATE subscriptions SET is_active = FALSE WHERE id = $1',
                [subscription.id]
            );
            
            return {
                hasActiveSubscription: false,
                subscription: null,
                message: 'Subscription has expired'
            };
        }

        return {
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
        };
    } catch (error) {
        logger.error('Error fetching user subscription:', error);
        throw new Error('Failed to fetch subscription');
    }
};

/**
 * Admin: Generate keys for a product
 */
const adminGenerateKeys = async (pool, keyData, generatedBy) => {
    try {
        const { productId, quantity, expiresAt } = keyData;

        // Verify product exists
        const productResult = await pool.query(
            'SELECT id, name, is_active FROM products WHERE id = $1',
            [productId]
        );

        if (productResult.rows.length === 0) {
            throw new Error('Product not found');
        }

        const product = productResult.rows[0];
        if (!product.is_active) {
            throw new Error('Cannot generate keys for inactive product');
        }

        // Generate keys
        const expirationDate = expiresAt ? new Date(expiresAt) : null;
        const keys = await generateKeysForProduct(pool, productId, quantity, generatedBy, expirationDate);

        return {
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
                expiresAt: expirationDate
            }
        };
    } catch (error) {
        logger.error('Key generation error:', error);
        throw error;
    }
};

/**
 * Admin: Get keys for a product with pagination
 */
const adminGetProductKeys = async (pool, productId, filters) => {
    try {
        const { page = 1, limit = 50, status = 'all' } = filters;
        return await getKeysForProduct(pool, productId, page, limit, status);
    } catch (error) {
        logger.error('Error fetching product keys:', error);
        throw new Error('Failed to fetch product keys');
    }
};

/**
 * Admin: Deactivate a key
 */
const adminDeactivateKey = async (pool, keyId, adminId) => {
    try {
        const success = await deactivateKey(pool, keyId, adminId);
        
        if (success) {
            return {
                success: true,
                message: 'Key deactivated successfully'
            };
        } else {
            throw new Error('Key not found or already redeemed');
        }
    } catch (error) {
        logger.error('Key deactivation error:', error);
        throw error;
    }
};

/**
 * Admin: Get key statistics
 */
const adminGetKeyStats = async (pool, productId = null) => {
    try {
        return await getKeyStatistics(pool, productId);
    } catch (error) {
        logger.error('Error getting key statistics:', error);
        throw new Error('Failed to get key statistics');
    }
};

/**
 * Desktop app: Check subscription by HWID
 */
const checkDesktopSubscription = async (pool, hwid, ip) => {
    try {
        const result = await pool.query(
            'SELECT * FROM get_active_subscription($1)',
            [hwid]
        );

        if (result.rows.length === 0) {
            // Log failed attempt
            await pool.query(
                'INSERT INTO audit_logs (action, details, ip_address) VALUES ($1, $2, $3)',
                ['DESKTOP_AUTH_CHECK', JSON.stringify({ hwid, success: false }), ip]
            );

            return {
                hasActiveSubscription: false,
                error: 'No active subscription found'
            };
        }

        const subscription = result.rows[0];
        
        // Log successful access
        await pool.query(
            'INSERT INTO audit_logs (action, details, ip_address) VALUES ($1, $2, $3)',
            ['DESKTOP_AUTH_CHECK', JSON.stringify({ hwid, success: true }), ip]
        );

        return {
            hasActiveSubscription: true,
            productName: subscription.product_name,
            expiresAt: subscription.expires_at,
            daysRemaining: subscription.days_remaining,
            timeRemaining: {
                days: Math.floor(subscription.days_remaining),
                hours: Math.floor((subscription.days_remaining % 1) * 24),
                minutes: Math.floor(((subscription.days_remaining % 1) * 24 % 1) * 60)
            }
        };
    } catch (error) {
        logger.error('Desktop subscription check error:', error);
        
        // Log failed attempt
        await pool.query(
            'INSERT INTO audit_logs (action, details, ip_address) VALUES ($1, $2, $3)',
            ['DESKTOP_AUTH_CHECK', JSON.stringify({ hwid, success: false, error: error.message }), ip]
        ).catch(() => {}); // Don't fail if audit log fails

        throw new Error('Internal server error');
    }
};

module.exports = {
    redeemUserKey,
    checkKeyStatus,
    getUserKeys,
    getUserSubscription,
    adminGenerateKeys,
    adminGetProductKeys,
    adminDeactivateKey,
    adminGetKeyStats,
    checkDesktopSubscription
};