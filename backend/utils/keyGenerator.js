const crypto = require('crypto');
const logger = require('./logger');

/**
 * Generate a unique key in XXXX-XXXX-XXXX-XXXX format
 * @param {Object} pool - Database pool
 * @returns {Promise<string>} - Generated unique key
 */
const generateUniqueKey = async (pool) => {
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
        const key = generateKeyCode();
        
        try {
            // Check if key already exists
            const existing = await pool.query(
                'SELECT id FROM keys WHERE key_code = $1',
                [key]
            );

            if (existing.rows.length === 0) {
                return key;
            }
        } catch (error) {
            logger.error('Database error while checking key uniqueness:', error);
            throw new Error('Key generation failed');
        }

        attempts++;
    }

    throw new Error('Failed to generate unique key after maximum attempts');
};

/**
 * Generate a random key code in XXXX-XXXX-XXXX-XXXX format
 * @returns {string} - Generated key code
 */
const generateKeyCode = () => {
    // Use alphanumeric characters excluding confusing ones (0, O, I, 1)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    
    const segments = [];
    for (let i = 0; i < 4; i++) {
        let segment = '';
        for (let j = 0; j < 4; j++) {
            segment += chars.charAt(crypto.randomInt(0, chars.length));
        }
        segments.push(segment);
    }
    
    return segments.join('-');
};

/**
 * Validate key code format
 * @param {string} keyCode - Key code to validate
 * @returns {boolean} - Whether the key code is valid
 */
const isValidKeyFormat = (keyCode) => {
    if (!keyCode || typeof keyCode !== 'string') {
        return false;
    }

    // Check format: XXXX-XXXX-XXXX-XXXX
    const keyPattern = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
    return keyPattern.test(keyCode);
};

/**
 * Generate multiple keys for a product
 * @param {Object} pool - Database pool
 * @param {string} productId - Product UUID
 * @param {number} quantity - Number of keys to generate
 * @param {string} generatedBy - Admin user ID who generated the keys
 * @param {Date|null} expiresAt - Optional expiration date for keys
 * @returns {Promise<Array>} - Array of generated key objects
 */
const generateKeysForProduct = async (pool, productId, quantity, generatedBy, expiresAt = null) => {
    if (!productId || !quantity || quantity < 1 || quantity > 1000) {
        throw new Error('Invalid parameters for key generation');
    }

    const keys = [];
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        for (let i = 0; i < quantity; i++) {
            const keyCode = await generateUniqueKey(pool);
            
            const result = await client.query(
                `INSERT INTO keys (key_code, product_id, generated_by, expires_at) 
                 VALUES ($1, $2, $3, $4) 
                 RETURNING id, key_code, created_at`,
                [keyCode, productId, generatedBy, expiresAt]
            );

            keys.push({
                id: result.rows[0].id,
                keyCode: result.rows[0].key_code,
                productId,
                generatedBy,
                expiresAt,
                createdAt: result.rows[0].created_at
            });
        }

        await client.query('COMMIT');
        
        logger.info(`Generated ${quantity} keys for product ${productId} by user ${generatedBy}`);
        return keys;

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error generating keys:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Redeem a key for a user
 * @param {Object} pool - Database pool
 * @param {string} keyCode - Key code to redeem
 * @param {string} userId - User ID redeeming the key
 * @param {string} hwid - Hardware ID of the user
 * @param {string} ip - IP address of the redemption
 * @returns {Promise<Object>} - Redemption result
 */
const redeemKey = async (pool, keyCode, userId, hwid, ip) => {
    if (!isValidKeyFormat(keyCode)) {
        throw new Error('Invalid key format');
    }

    if (!userId || !hwid) {
        throw new Error('User ID and HWID are required');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Get key details with product info
        const keyResult = await client.query(
            `SELECT k.id, k.key_code, k.product_id, k.redeemed_by, k.hwid_lock, 
                    k.redeemed_at, k.expires_at, k.is_active,
                    p.name as product_name, p.duration_days, p.price
             FROM keys k
             JOIN products p ON k.product_id = p.id
             WHERE k.key_code = $1`,
            [keyCode]
        );

        if (keyResult.rows.length === 0) {
            throw new Error('Key not found');
        }

        const key = keyResult.rows[0];

        // Check if key is already redeemed
        if (key.redeemed_by) {
            // Get the user who redeemed it
            const redeemerResult = await client.query(
                'SELECT email FROM users WHERE id = $1',
                [key.redeemed_by]
            );

            throw new Error(`Key already redeemed by ${redeemerResult.rows[0]?.email || 'unknown user'}`);
        }

        // Check if key is expired
        if (key.expires_at && new Date() > key.expires_at) {
            throw new Error('Key has expired');
        }

        // Check if key is active
        if (!key.is_active) {
            throw new Error('Key is not active');
        }

        // Check if user already has an active subscription on this HWID
        const existingSubscription = await client.query(
            'SELECT id, expires_at FROM subscriptions WHERE hwid = $1 AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP',
            [hwid]
        );

        if (existingSubscription.rows.length > 0) {
            throw new Error('An active subscription already exists for this device');
        }

        // Calculate subscription dates
        const startDate = new Date();
        const endDate = new Date();
        
        if (key.duration_days === 999999) {
            // Lifetime subscription - set far future date
            endDate.setFullYear(endDate.getFullYear() + 100);
        } else {
            endDate.setDate(endDate.getDate() + key.duration_days);
        }

        // Mark key as redeemed
        await client.query(
            `UPDATE keys 
             SET redeemed_by = $1, hwid_lock = $2, redeemed_at = CURRENT_TIMESTAMP, redemption_ip = $3
             WHERE id = $4`,
            [userId, hwid, ip, key.id]
        );

        // Create subscription
        const subscriptionResult = await client.query(
            `INSERT INTO subscriptions (user_id, product_id, key_id, hwid, starts_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, starts_at, expires_at`,
            [userId, key.product_id, key.id, hwid, startDate, endDate]
        );

        const subscription = subscriptionResult.rows[0];

        // Create purchase record
        await client.query(
            `INSERT INTO purchases (user_id, product_id, key_id, amount, payment_method, payment_status, ip_address)
             VALUES ($1, $2, $3, $4, 'key_redemption', 'completed', $5)`,
            [userId, key.product_id, key.id, key.price, ip]
        );

        await client.query('COMMIT');

        logger.info(`Key ${keyCode} redeemed by user ${userId} for HWID ${hwid}`);

        return {
            success: true,
            subscription: {
                id: subscription.id,
                productName: key.product_name,
                durationDays: key.duration_days,
                startsAt: subscription.starts_at,
                expiresAt: subscription.expires_at,
                isLifetime: key.duration_days === 999999
            },
            key: {
                code: key.key_code,
                redeemedAt: new Date()
            }
        };

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Key redemption error:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Check if a key exists and get its status
 * @param {Object} pool - Database pool
 * @param {string} keyCode - Key code to check
 * @returns {Promise<Object>} - Key status information
 */
const getKeyStatus = async (pool, keyCode) => {
    if (!isValidKeyFormat(keyCode)) {
        throw new Error('Invalid key format');
    }

    try {
        const result = await pool.query(
            `SELECT k.id, k.key_code, k.redeemed_by, k.hwid_lock, k.redeemed_at, 
                    k.expires_at, k.is_active, k.created_at,
                    p.name as product_name, p.duration_days, p.price,
                    u.email as redeemed_by_email
             FROM keys k
             JOIN products p ON k.product_id = p.id
             LEFT JOIN users u ON k.redeemed_by = u.id
             WHERE k.key_code = $1`,
            [keyCode]
        );

        if (result.rows.length === 0) {
            return {
                exists: false,
                error: 'Key not found'
            };
        }

        const key = result.rows[0];
        const now = new Date();
        const isExpired = key.expires_at && now > key.expires_at;
        const isRedeemed = !!key.redeemed_by;

        return {
            exists: true,
            keyCode: key.key_code,
            productName: key.product_name,
            durationDays: key.duration_days,
            price: key.price,
            isActive: key.is_active,
            isRedeemed,
            isExpired,
            redeemedBy: key.redeemed_by_email,
            redeemedAt: key.redeemed_at,
            expiresAt: key.expires_at,
            createdAt: key.created_at,
            status: isRedeemed ? 'redeemed' : isExpired ? 'expired' : 'available'
        };

    } catch (error) {
        logger.error('Error checking key status:', error);
        throw error;
    }
};

/**
 * Get all keys for a product with pagination
 * @param {Object} pool - Database pool
 * @param {string} productId - Product UUID
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Items per page
 * @param {string} status - Filter by status: 'all', 'available', 'redeemed', 'expired'
 * @returns {Promise<Object>} - Paginated keys result
 */
const getKeysForProduct = async (pool, productId, page = 1, limit = 50, status = 'all') => {
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE k.product_id = $1';
    let params = [productId];
    
    if (status === 'available') {
        whereClause += ' AND k.redeemed_by IS NULL AND k.is_active = TRUE AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP)';
    } else if (status === 'redeemed') {
        whereClause += ' AND k.redeemed_by IS NOT NULL';
    } else if (status === 'expired') {
        whereClause += ' AND k.expires_at IS NOT NULL AND k.expires_at <= CURRENT_TIMESTAMP AND k.redeemed_by IS NULL';
    }

    try {
        // Get total count
        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM keys k ${whereClause}`,
            params
        );

        const total = parseInt(countResult.rows[0].total);

        // Get keys
        const keysResult = await pool.query(
            `SELECT k.id, k.key_code, k.redeemed_by, k.hwid_lock, k.redeemed_at,
                    k.expires_at, k.is_active, k.created_at, k.redemption_ip,
                    u.email as redeemed_by_email,
                    p.name as product_name
             FROM keys k
             JOIN products p ON k.product_id = p.id
             LEFT JOIN users u ON k.redeemed_by = u.id
             ${whereClause}
             ORDER BY k.created_at DESC
             LIMIT ${params.length + 1} OFFSET ${params.length + 2}`,
            [...params, limit, offset]
        );

        return {
            keys: keysResult.rows.map(key => ({
                id: key.id,
                keyCode: key.key_code,
                productName: key.product_name,
                isRedeemed: !!key.redeemed_by,
                redeemedBy: key.redeemed_by_email,
                redeemedAt: key.redeemed_at,
                hwidLock: key.hwid_lock,
                redemptionIp: key.redemption_ip,
                expiresAt: key.expires_at,
                isActive: key.is_active,
                createdAt: key.created_at,
                status: key.redeemed_by ? 'redeemed' : 
                       (key.expires_at && new Date() > key.expires_at) ? 'expired' : 'available'
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page < Math.ceil(total / limit),
                hasPrevPage: page > 1
            }
        };

    } catch (error) {
        logger.error('Error getting keys for product:', error);
        throw error;
    }
};

/**
 * Deactivate a key (admin function)
 * @param {Object} pool - Database pool
 * @param {string} keyId - Key UUID to deactivate
 * @param {string} adminId - Admin user ID performing the action
 * @returns {Promise<boolean>} - Success status
 */
const deactivateKey = async (pool, keyId, adminId) => {
    try {
        const result = await pool.query(
            'UPDATE keys SET is_active = FALSE WHERE id = $1 AND redeemed_by IS NULL RETURNING id, key_code',
            [keyId]
        );

        if (result.rows.length === 0) {
            throw new Error('Key not found or already redeemed');
        }

        logger.info(`Key ${result.rows[0].key_code} deactivated by admin ${adminId}`);
        return true;

    } catch (error) {
        logger.error('Error deactivating key:', error);
        throw error;
    }
};

/**
 * Get key statistics for admin dashboard
 * @param {Object} pool - Database pool
 * @param {string} productId - Optional product ID to filter by
 * @returns {Promise<Object>} - Key statistics
 */
const getKeyStatistics = async (pool, productId = null) => {
    try {
        let whereClause = '';
        let params = [];

        if (productId) {
            whereClause = 'WHERE k.product_id = $1';
            params = [productId];
        }

        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_keys,
                COUNT(CASE WHEN k.redeemed_by IS NULL AND k.is_active = TRUE 
                          AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP) 
                          THEN 1 END) as available_keys,
                COUNT(CASE WHEN k.redeemed_by IS NOT NULL THEN 1 END) as redeemed_keys,
                COUNT(CASE WHEN k.expires_at IS NOT NULL AND k.expires_at <= CURRENT_TIMESTAMP 
                          AND k.redeemed_by IS NULL THEN 1 END) as expired_keys,
                COUNT(CASE WHEN k.is_active = FALSE THEN 1 END) as inactive_keys
             FROM keys k
             ${whereClause}`,
            params
        );

        const stats = result.rows[0];

        return {
            totalKeys: parseInt(stats.total_keys),
            availableKeys: parseInt(stats.available_keys),
            redeemedKeys: parseInt(stats.redeemed_keys),
            expiredKeys: parseInt(stats.expired_keys),
            inactiveKeys: parseInt(stats.inactive_keys)
        };

    } catch (error) {
        logger.error('Error getting key statistics:', error);
        throw error;
    }
};

module.exports = {
    generateUniqueKey,
    generateKeyCode,
    isValidKeyFormat,
    generateKeysForProduct,
    redeemKey,
    getKeyStatus,
    getKeysForProduct,
    deactivateKey,
    getKeyStatistics
};