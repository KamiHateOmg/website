const logger = require('../utils/logger');

class Subscription {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Create a new subscription
     */
    async create(subscriptionData) {
        const { userId, productId, keyId, hwid, startsAt, expiresAt } = subscriptionData;

        if (!userId || !productId || !keyId || !hwid || !startsAt || !expiresAt) {
            throw new Error('All subscription fields are required');
        }

        try {
            // Check if there's already an active subscription for this HWID
            const existingSubscription = await this.pool.query(
                'SELECT id FROM subscriptions WHERE hwid = $1 AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP',
                [hwid]
            );

            if (existingSubscription.rows.length > 0) {
                throw new Error('An active subscription already exists for this device');
            }

            const result = await this.pool.query(
                `INSERT INTO subscriptions (user_id, product_id, key_id, hwid, starts_at, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, user_id, product_id, key_id, hwid, starts_at, expires_at, is_active, created_at`,
                [userId, productId, keyId, hwid, startsAt, expiresAt]
            );

            const subscription = result.rows[0];
            return this.formatSubscription(subscription);

        } catch (error) {
            logger.error('Error creating subscription:', error);
            throw error;
        }
    }

    /**
     * Get user's active subscription
     */
    async getUserActiveSubscription(userId, hwid = null) {
        try {
            let query = `
                SELECT 
                    s.id, s.user_id, s.product_id, s.key_id, s.hwid,
                    s.starts_at, s.expires_at, s.is_active, s.created_at,
                    p.name as product_name, p.duration_days, p.price,
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

            const result = await this.pool.query(query, params);

            if (result.rows.length === 0) {
                return null;
            }

            const subscription = result.rows[0];
            const isExpired = new Date() >= new Date(subscription.expires_at);

            // If subscription is expired, deactivate it
            if (isExpired && subscription.is_active) {
                await this.deactivate(subscription.id);
                return null;
            }

            return this.formatSubscriptionWithDetails(subscription);

        } catch (error) {
            logger.error('Error getting user active subscription:', error);
            throw error;
        }
    }

    /**
     * Get active subscription by HWID (for desktop app)
     */
    async getActiveByHWID(hwid) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM get_active_subscription($1)',
                [hwid]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const subscription = result.rows[0];
            
            return {
                subscriptionId: subscription.subscription_id,
                productName: subscription.product_name,
                expiresAt: subscription.expires_at,
                daysRemaining: Math.max(0, subscription.days_remaining),
                timeRemaining: {
                    days: Math.floor(Math.max(0, subscription.days_remaining)),
                    hours: Math.floor((Math.max(0, subscription.days_remaining) % 1) * 24),
                    minutes: Math.floor(((Math.max(0, subscription.days_remaining) % 1) * 24 % 1) * 60)
                }
            };

        } catch (error) {
            logger.error('Error getting active subscription by HWID:', error);
            throw error;
        }
    }

    /**
     * Get all user subscriptions
     */
    async getUserSubscriptions(userId, page = 1, limit = 20, includeExpired = true) {
        try {
            const offset = (page - 1) * limit;
            
            let whereClause = 'WHERE s.user_id = $1';
            let params = [userId];

            if (!includeExpired) {
                whereClause += ' AND s.expires_at > CURRENT_TIMESTAMP';
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total FROM subscriptions s ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get subscriptions
            const subscriptionsResult = await this.pool.query(
                `SELECT 
                    s.id, s.hwid, s.starts_at, s.expires_at, s.is_active, s.created_at,
                    p.name as product_name, p.duration_days, p.price,
                    k.key_code,
                    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400 as days_remaining,
                    CASE 
                        WHEN s.expires_at > CURRENT_TIMESTAMP AND s.is_active = TRUE THEN 'active'
                        WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                        ELSE 'inactive'
                    END as status
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN keys k ON s.key_id = k.id
                 ${whereClause}
                 ORDER BY s.expires_at DESC
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, limit, offset]
            );

            return {
                subscriptions: subscriptionsResult.rows.map(sub => this.formatSubscriptionWithDetails(sub)),
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
            logger.error('Error getting user subscriptions:', error);
            throw error;
        }
    }

    /**
     * Get all subscriptions (admin function)
     */
    async getAll(page = 1, limit = 50, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let params = [];
            let paramCount = 1;

            // Build WHERE clause from filters
            const conditions = [];
            if (filters.isActive !== undefined) {
                conditions.push(`s.is_active = $${paramCount}`);
                params.push(filters.isActive);
                paramCount++;
            }
            if (filters.status === 'active') {
                conditions.push(`s.expires_at > CURRENT_TIMESTAMP AND s.is_active = TRUE`);
            } else if (filters.status === 'expired') {
                conditions.push(`s.expires_at <= CURRENT_TIMESTAMP`);
            }
            if (filters.productId) {
                conditions.push(`s.product_id = $${paramCount}`);
                params.push(filters.productId);
                paramCount++;
            }
            if (filters.userEmail) {
                conditions.push(`u.email ILIKE $${paramCount}`);
                params.push(`%${filters.userEmail}%`);
                paramCount++;
            }
            if (filters.hwid) {
                conditions.push(`s.hwid = $${paramCount}`);
                params.push(filters.hwid);
                paramCount++;
            }

            if (conditions.length > 0) {
                whereClause = `WHERE ${conditions.join(' AND ')}`;
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total 
                 FROM subscriptions s 
                 JOIN users u ON s.user_id = u.id 
                 ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get subscriptions
            const subscriptionsResult = await this.pool.query(
                `SELECT 
                    s.id, s.user_id, s.hwid, s.starts_at, s.expires_at, s.is_active, s.created_at,
                    p.name as product_name, p.duration_days, p.price,
                    u.email as user_email,
                    k.key_code,
                    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400 as days_remaining,
                    CASE 
                        WHEN s.expires_at > CURRENT_TIMESTAMP AND s.is_active = TRUE THEN 'active'
                        WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                        ELSE 'inactive'
                    END as status
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN users u ON s.user_id = u.id
                 JOIN keys k ON s.key_id = k.id
                 ${whereClause}
                 ORDER BY s.expires_at DESC
                 LIMIT ${paramCount} OFFSET ${paramCount + 1}`,
                [...params, limit, offset]
            );

            return {
                subscriptions: subscriptionsResult.rows.map(sub => this.formatSubscriptionForAdmin(sub)),
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
            logger.error('Error getting all subscriptions:', error);
            throw error;
        }
    }

    /**
     * Deactivate a subscription
     */
    async deactivate(subscriptionId) {
        try {
            const result = await this.pool.query(
                'UPDATE subscriptions SET is_active = FALSE WHERE id = $1 RETURNING id, hwid',
                [subscriptionId]
            );

            if (result.rows.length === 0) {
                throw new Error('Subscription not found');
            }

            logger.info(`Subscription ${subscriptionId} deactivated`);
            return result.rows[0];

        } catch (error) {
            logger.error('Error deactivating subscription:', error);
            throw error;
        }
    }

    /**
     * Deactivate expired subscriptions (cleanup function)
     */
    async deactivateExpired() {
        try {
            const result = await this.pool.query(
                'SELECT deactivate_expired_subscriptions()'
            );

            logger.info('Expired subscriptions cleanup completed');
            return true;

        } catch (error) {
            logger.error('Error deactivating expired subscriptions:', error);
            throw error;
        }
    }

    /**
     * Check if user has active subscription
     */
    async hasActiveSubscription(userId, hwid = null) {
        try {
            let query = `
                SELECT COUNT(*) as count
                FROM subscriptions 
                WHERE user_id = $1 AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP
            `;
            let params = [userId];

            if (hwid) {
                query += ' AND hwid = $2';
                params.push(hwid);
            }

            const result = await this.pool.query(query, params);
            return parseInt(result.rows[0].count) > 0;

        } catch (error) {
            logger.error('Error checking active subscription:', error);
            throw error;
        }
    }

    /**
     * Get subscription statistics
     */
    async getStatistics(productId = null) {
        try {
            let whereClause = '';
            let params = [];

            if (productId) {
                whereClause = 'WHERE s.product_id = $1';
                params = [productId];
            }

            const result = await this.pool.query(
                `SELECT 
                    COUNT(*) as total_subscriptions,
                    COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP 
                              THEN 1 END) as active_subscriptions,
                    COUNT(CASE WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 1 END) as expired_subscriptions,
                    COUNT(CASE WHEN s.is_active = FALSE THEN 1 END) as inactive_subscriptions,
                    COUNT(DISTINCT s.user_id) as unique_users,
                    COUNT(DISTINCT s.hwid) as unique_devices,
                    AVG(EXTRACT(EPOCH FROM (s.expires_at - s.starts_at)) / 86400) as avg_duration_days
                 FROM subscriptions s
                 ${whereClause}`,
                params
            );

            const stats = result.rows[0];

            return {
                totalSubscriptions: parseInt(stats.total_subscriptions),
                activeSubscriptions: parseInt(stats.active_subscriptions),
                expiredSubscriptions: parseInt(stats.expired_subscriptions),
                inactiveSubscriptions: parseInt(stats.inactive_subscriptions),
                uniqueUsers: parseInt(stats.unique_users),
                uniqueDevices: parseInt(stats.unique_devices),
                averageDurationDays: parseFloat(stats.avg_duration_days) || 0
            };

        } catch (error) {
            logger.error('Error getting subscription statistics:', error);
            throw error;
        }
    }

    /**
     * Get expiring subscriptions (for notifications)
     */
    async getExpiring(days = 7) {
        try {
            const result = await this.pool.query(
                `SELECT 
                    s.id, s.user_id, s.hwid, s.expires_at,
                    p.name as product_name,
                    u.email as user_email,
                    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400 as days_remaining
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN users u ON s.user_id = u.id
                 WHERE s.is_active = TRUE 
                 AND s.expires_at > CURRENT_TIMESTAMP
                 AND s.expires_at <= CURRENT_TIMESTAMP + INTERVAL '${days} days'
                 ORDER BY s.expires_at ASC`,
                []
            );

            return result.rows.map(sub => ({
                id: sub.id,
                userId: sub.user_id,
                userEmail: sub.user_email,
                hwid: sub.hwid,
                productName: sub.product_name,
                expiresAt: sub.expires_at,
                daysRemaining: Math.ceil(sub.days_remaining)
            }));

        } catch (error) {
            logger.error('Error getting expiring subscriptions:', error);
            throw error;
        }
    }

    /**
     * Extend subscription
     */
    async extend(subscriptionId, additionalDays) {
        try {
            const result = await this.pool.query(
                `UPDATE subscriptions 
                 SET expires_at = expires_at + INTERVAL '${additionalDays} days',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 
                 RETURNING id, expires_at`,
                [subscriptionId]
            );

            if (result.rows.length === 0) {
                throw new Error('Subscription not found');
            }

            logger.info(`Subscription ${subscriptionId} extended by ${additionalDays} days`);
            return result.rows[0];

        } catch (error) {
            logger.error('Error extending subscription:', error);
            throw error;
        }
    }

    /**
     * Get subscription by ID
     */
    async findById(subscriptionId) {
        try {
            const result = await this.pool.query(
                `SELECT 
                    s.id, s.user_id, s.product_id, s.key_id, s.hwid,
                    s.starts_at, s.expires_at, s.is_active, s.created_at, s.updated_at,
                    p.name as product_name, p.duration_days, p.price,
                    u.email as user_email,
                    k.key_code
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN users u ON s.user_id = u.id
                 JOIN keys k ON s.key_id = k.id
                 WHERE s.id = $1`,
                [subscriptionId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.formatSubscriptionForAdmin(result.rows[0]);

        } catch (error) {
            logger.error('Error finding subscription by ID:', error);
            throw error;
        }
    }

    /**
     * Get user's subscription history
     */
    async getUserHistory(userId, page = 1, limit = 20) {
        try {
            const offset = (page - 1) * limit;

            // Get total count
            const countResult = await this.pool.query(
                'SELECT COUNT(*) as total FROM subscriptions WHERE user_id = $1',
                [userId]
            );
            const total = parseInt(countResult.rows[0].total);

            // Get subscriptions
            const subscriptionsResult = await this.pool.query(
                `SELECT 
                    s.id, s.hwid, s.starts_at, s.expires_at, s.is_active, s.created_at,
                    p.name as product_name, p.duration_days, p.price,
                    k.key_code,
                    CASE 
                        WHEN s.expires_at > CURRENT_TIMESTAMP AND s.is_active = TRUE THEN 'active'
                        WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                        ELSE 'inactive'
                    END as status
                 FROM subscriptions s
                 JOIN products p ON s.product_id = p.id
                 JOIN keys k ON s.key_id = k.id
                 WHERE s.user_id = $1
                 ORDER BY s.created_at DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );

            return {
                subscriptions: subscriptionsResult.rows.map(sub => this.formatSubscriptionWithDetails(sub)),
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
            logger.error('Error getting user subscription history:', error);
            throw error;
        }
    }

    /**
     * Format subscription for API response
     */
    formatSubscription(subscription) {
        return {
            id: subscription.id,
            userId: subscription.user_id,
            productId: subscription.product_id,
            keyId: subscription.key_id,
            hwid: subscription.hwid,
            startsAt: subscription.starts_at,
            expiresAt: subscription.expires_at,
            isActive: subscription.is_active,
            createdAt: subscription.created_at,
            updatedAt: subscription.updated_at
        };
    }

    /**
     * Format subscription with product details
     */
    formatSubscriptionWithDetails(subscription) {
        const daysRemaining = Math.max(0, Math.ceil(subscription.days_remaining || 0));
        
        return {
            id: subscription.id,
            productName: subscription.product_name,
            durationDays: subscription.duration_days,
            hwid: subscription.hwid,
            startsAt: subscription.starts_at,
            expiresAt: subscription.expires_at,
            createdAt: subscription.created_at,
            keyCode: subscription.key_code,
            daysRemaining,
            status: subscription.status,
            isLifetime: subscription.duration_days === 999999,
            timeRemaining: {
                days: Math.floor(daysRemaining),
                hours: Math.floor((daysRemaining % 1) * 24),
                minutes: Math.floor(((daysRemaining % 1) * 24 % 1) * 60)
            }
        };
    }

    /**
     * Format subscription for admin response
     */
    formatSubscriptionForAdmin(subscription) {
        const daysRemaining = Math.max(0, Math.ceil(subscription.days_remaining || 0));
        
        return {
            id: subscription.id,
            userId: subscription.user_id,
            userEmail: subscription.user_email,
            productName: subscription.product_name,
            durationDays: subscription.duration_days,
            price: parseFloat(subscription.price),
            hwid: subscription.hwid,
            startsAt: subscription.starts_at,
            expiresAt: subscription.expires_at,
            isActive: subscription.is_active,
            createdAt: subscription.created_at,
            keyCode: subscription.key_code,
            daysRemaining,
            status: subscription.status,
            isLifetime: subscription.duration_days === 999999
        };
    }

    /**
     * Validate HWID format
     */
    isValidHWID(hwid) {
        if (!hwid || typeof hwid !== 'string') {
            return false;
        }

        // Basic HWID validation pattern
        const hwidPattern = /^[A-Za-z0-9-]{10,255}$/;
        return hwidPattern.test(hwid);
    }

    /**
     * Check if subscription is active
     */
    isActive(subscription) {
        if (!subscription || !subscription.is_active) {
            return false;
        }

        const now = new Date();
        const expiresAt = new Date(subscription.expires_at);
        
        return expiresAt > now;
    }
}

module.exports = Subscription;