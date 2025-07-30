const crypto = require('crypto');
const logger = require('../utils/logger');

class Key {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Generate a unique key code
     */
    async generateUniqueKeyCode() {
        let attempts = 0;
        const maxAttempts = 100;

        while (attempts < maxAttempts) {
            const keyCode = this.generateKeyCode();
            
            try {
                // Check if key already exists
                const existing = await this.pool.query(
                    'SELECT id FROM keys WHERE key_code = $1',
                    [keyCode]
                );

                if (existing.rows.length === 0) {
                    return keyCode;
                }
            } catch (error) {
                logger.error('Database error while checking key uniqueness:', error);
                throw new Error('Key generation failed');
            }

            attempts++;
        }

        throw new Error('Failed to generate unique key after maximum attempts');
    }

    /**
     * Generate a random key code in XXXX-XXXX-XXXX-XXXX format
     */
    generateKeyCode() {
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
    }

    /**
     * Validate key code format
     */
    isValidKeyFormat(keyCode) {
        if (!keyCode || typeof keyCode !== 'string') {
            return false;
        }

        // Check format: XXXX-XXXX-XXXX-XXXX
        const keyPattern = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
        return keyPattern.test(keyCode);
    }

    /**
     * Generate multiple keys for a product
     */
    async generateKeys(productId, quantity, generatedBy, expiresAt = null) {
        if (!productId || !quantity || quantity < 1 || quantity > 1000) {
            throw new Error('Invalid parameters for key generation');
        }

        const keys = [];
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            for (let i = 0; i < quantity; i++) {
                const keyCode = await this.generateUniqueKeyCode();
                
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
    }

    /**
     * Find key by code with product details
     */
    async findByCode(keyCode) {
        try {
            const result = await this.pool.query(
                `SELECT k.id, k.key_code, k.product_id, k.generated_by, k.purchased_by, 
                        k.redeemed_by, k.hwid_lock, k.redeemed_at, k.expires_at, k.is_active,
                        k.redemption_ip, k.created_at, k.updated_at,
                        p.name as product_name, p.duration_days, p.price,
                        u.email as redeemed_by_email
                 FROM keys k
                 JOIN products p ON k.product_id = p.id
                 LEFT JOIN users u ON k.redeemed_by = u.id
                 WHERE k.key_code = $1`,
                [keyCode]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.formatKey(result.rows[0]);

        } catch (error) {
            logger.error('Error finding key by code:', error);
            throw error;
        }
    }

    /**
     * Get key status information
     */
    async getStatus(keyCode) {
        if (!this.isValidKeyFormat(keyCode)) {
            throw new Error('Invalid key format');
        }

        try {
            const key = await this.findByCode(keyCode);
            
            if (!key) {
                return {
                    exists: false,
                    error: 'Key not found'
                };
            }

            const now = new Date();
            const isExpired = key.expiresAt && now > key.expiresAt;
            const isRedeemed = !!key.redeemedBy;

            return {
                exists: true,
                keyCode: key.keyCode,
                productName: key.productName,
                durationDays: key.durationDays,
                price: key.price,
                isActive: key.isActive,
                isRedeemed,
                isExpired,
                redeemedBy: key.redeemedByEmail,
                redeemedAt: key.redeemedAt,
                expiresAt: key.expiresAt,
                createdAt: key.createdAt,
                status: isRedeemed ? 'redeemed' : isExpired ? 'expired' : 'available'
            };

        } catch (error) {
            logger.error('Error checking key status:', error);
            throw error;
        }
    }

    /**
     * Redeem a key for a user
     */
    async redeem(keyCode, userId, hwid, ip) {
        if (!this.isValidKeyFormat(keyCode)) {
            throw new Error('Invalid key format');
        }

        if (!userId || !hwid) {
            throw new Error('User ID and HWID are required');
        }

        const client = await this.pool.connect();

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

            // Create purchase record if not already exists
            const existingPurchase = await client.query(
                'SELECT id FROM purchases WHERE key_id = $1',
                [key.id]
            );

            if (existingPurchase.rows.length === 0) {
                await client.query(
                    `INSERT INTO purchases (user_id, product_id, key_id, amount, payment_method, payment_status, ip_address)
                     VALUES ($1, $2, $3, $4, 'key_redemption', 'completed', $5)`,
                    [userId, key.product_id, key.id, key.price, ip]
                );
            }

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
    }

    /**
     * Get keys for a user
     */
    async getUserKeys(userId, page = 1, limit = 20, status = 'all') {
        try {
            const offset = (page - 1) * limit;
            
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
            
            const countResult = await this.pool.query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            // Get keys with pagination
            params.push(limit, offset);
            const keysQuery = `
                SELECT 
                    k.id, k.key_code, k.redeemed_by, k.redeemed_at, k.expires_at, k.is_active,
                    k.created_at, k.hwid_lock, k.purchased_by,
                    p.name as product_name, p.duration_days, p.price,
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
                LIMIT ${paramCount + 1} OFFSET ${paramCount + 2}
            `;

            const keysResult = await this.pool.query(keysQuery, params);

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
            throw error;
        }
    }

    /**
     * Get keys for a product (admin function)
     */
    async getProductKeys(productId, page = 1, limit = 50, status = 'all') {
        try {
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

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total FROM keys k ${whereClause}`,
                params
            );

            const total = parseInt(countResult.rows[0].total);

            // Get keys
            const keysResult = await this.pool.query(
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
                keys: keysResult.rows.map(key => this.formatKeyForAdmin(key)),
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
    }

    /**
     * Deactivate a key (admin function)
     */
    async deactivate(keyId, adminId) {
        try {
            const result = await this.pool.query(
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
    }

    /**
     * Get key statistics
     */
    async getStatistics(productId = null) {
        try {
            let whereClause = '';
            let params = [];

            if (productId) {
                whereClause = 'WHERE k.product_id = $1';
                params = [productId];
            }

            const result = await this.pool.query(
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
    }

    /**
     * Mark key as purchased by user
     */
    async markAsPurchased(keyId, userId) {
        try {
            const result = await this.pool.query(
                'UPDATE keys SET purchased_by = $1 WHERE id = $2 RETURNING id',
                [userId, keyId]
            );

            return result.rows.length > 0;

        } catch (error) {
            logger.error('Error marking key as purchased:', error);
            throw error;
        }
    }

    /**
     * Format key for API response
     */
    formatKey(key) {
        return {
            id: key.id,
            keyCode: key.key_code,
            productId: key.product_id,
            productName: key.product_name,
            durationDays: key.duration_days,
            price: parseFloat(key.price),
            generatedBy: key.generated_by,
            purchasedBy: key.purchased_by,
            redeemedBy: key.redeemed_by,
            redeemedByEmail: key.redeemed_by_email,
            hwidLock: key.hwid_lock,
            redeemedAt: key.redeemed_at,
            expiresAt: key.expires_at,
            isActive: key.is_active,
            redemptionIp: key.redemption_ip,
            createdAt: key.created_at,
            updatedAt: key.updated_at
        };
    }

    /**
     * Format key for admin response
     */
    formatKeyForAdmin(key) {
        return {
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
        };
    }
}

module.exports = Key;