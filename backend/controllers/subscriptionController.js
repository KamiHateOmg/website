const logger = require('../utils/logger');

/**
 * Format subscription for API response
 */
const formatSubscription = (subscription) => {
    const now = new Date();
    const expiresAt = new Date(subscription.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
    
    return {
        id: subscription.id,
        productName: subscription.product_name,
        productId: subscription.product_id,
        keyCode: subscription.key_code,
        hwid: subscription.hwid,
        startsAt: subscription.starts_at,
        expiresAt: subscription.expires_at,
        isActive: subscription.is_active,
        createdAt: subscription.created_at,
        durationDays: subscription.duration_days,
        price: subscription.price ? parseFloat(subscription.price) : null,
        daysRemaining: daysRemaining,
        isLifetime: subscription.duration_days === 999999,
        isExpired: expiresAt <= now,
        status: expiresAt <= now ? 'expired' : subscription.is_active ? 'active' : 'inactive',
        timeRemaining: {
            days: Math.floor(daysRemaining),
            hours: Math.floor((daysRemaining % 1) * 24),
            minutes: Math.floor(((daysRemaining % 1) * 24 % 1) * 60)
        }
    };
};

/**
 * Get user's active subscriptions
 */
const getUserSubscriptions = async (pool, userId, filters = {}) => {
    try {
        const { status = 'all', hwid, limit = 50, offset = 0 } = filters;
        
        let whereClause = 'WHERE s.user_id = $1';
        let params = [userId];
        let paramCount = 2;

        // Add status filter
        if (status === 'active') {
            whereClause += ' AND s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP';
        } else if (status === 'expired') {
            whereClause += ' AND (s.is_active = FALSE OR s.expires_at <= CURRENT_TIMESTAMP)';
        } else if (status === 'inactive') {
            whereClause += ' AND s.is_active = FALSE';
        }

        // Add HWID filter
        if (hwid) {
            whereClause += ` AND s.hwid = $${paramCount}`;
            params.push(hwid);
            paramCount++;
        }

        const query = `
            SELECT 
                s.id,
                s.product_id,
                s.hwid,
                s.starts_at,
                s.expires_at,
                s.is_active,
                s.created_at,
                p.name as product_name,
                p.duration_days,
                p.price,
                k.key_code
            FROM subscriptions s
            JOIN products p ON s.product_id = p.id
            JOIN keys k ON s.key_id = k.id
            ${whereClause}
            ORDER BY s.created_at DESC
            LIMIT $${paramCount} OFFSET $${paramCount + 1}
        `;

        params.push(limit, offset);
        const result = await pool.query(query, params);

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM subscriptions s
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, params.slice(0, -2));

        const subscriptions = result.rows.map(formatSubscription);

        return {
            subscriptions,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(countResult.rows[0].total) > parseInt(offset) + parseInt(limit)
            },
            summary: {
                total: subscriptions.length,
                active: subscriptions.filter(s => s.status === 'active').length,
                expired: subscriptions.filter(s => s.status === 'expired').length,
                inactive: subscriptions.filter(s => s.status === 'inactive').length
            }
        };
    } catch (error) {
        logger.error('Error fetching user subscriptions:', error);
        throw new Error('Failed to fetch subscriptions');
    }
};

/**
 * Get subscription by ID
 */
const getSubscriptionById = async (pool, subscriptionId, userId = null) => {
    try {
        let query = `
            SELECT 
                s.id,
                s.user_id,
                s.product_id,
                s.hwid,
                s.starts_at,
                s.expires_at,
                s.is_active,
                s.created_at,
                p.name as product_name,
                p.duration_days,
                p.price,
                k.key_code,
                u.email as user_email
            FROM subscriptions s
            JOIN products p ON s.product_id = p.id
            JOIN keys k ON s.key_id = k.id
            JOIN users u ON s.user_id = u.id
            WHERE s.id = $1
        `;

        let params = [subscriptionId];

        // If userId is provided, ensure user can only access their own subscription
        if (userId) {
            query += ' AND s.user_id = $2';
            params.push(userId);
        }

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            throw new Error('Subscription not found');
        }

        const subscription = result.rows[0];

        return {
            ...formatSubscription(subscription),
            userEmail: subscription.user_email,
            userId: subscription.user_id
        };
    } catch (error) {
        logger.error('Error fetching subscription:', error);
        throw error;
    }
};

/**
 * Check if HWID has active subscription
 */
const checkHwidSubscription = async (pool, hwid) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.expires_at, s.user_id, p.name as product_name, u.email
             FROM subscriptions s
             JOIN products p ON s.product_id = p.id
             JOIN users u ON s.user_id = u.id
             WHERE s.hwid = $1 AND s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP
             ORDER BY s.expires_at DESC
             LIMIT 1`,
            [hwid]
        );

        if (result.rows.length === 0) {
            return {
                hasActiveSubscription: false,
                subscription: null
            };
        }

        const subscription = result.rows[0];

        return {
            hasActiveSubscription: true,
            subscription: {
                id: subscription.id,
                productName: subscription.product_name,
                expiresAt: subscription.expires_at,
                userEmail: subscription.email,
                userId: subscription.user_id
            }
        };
    } catch (error) {
        logger.error('Error checking HWID subscription:', error);
        throw new Error('Failed to check subscription');
    }
};

/**
 * Get subscription usage statistics
 */
const getSubscriptionStats = async (pool, userId = null) => {
    try {
        let whereClause = '';
        let params = [];

        if (userId) {
            whereClause = 'WHERE s.user_id = $1';
            params = [userId];
        }

        const query = `
            SELECT 
                COUNT(*) as total_subscriptions,
                COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_subscriptions,
                COUNT(CASE WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 1 END) as expired_subscriptions,
                COUNT(CASE WHEN s.is_active = FALSE THEN 1 END) as inactive_subscriptions,
                COUNT(DISTINCT s.hwid) as unique_devices,
                COUNT(DISTINCT s.product_id) as unique_products,
                AVG(EXTRACT(EPOCH FROM (s.expires_at - s.starts_at)) / 86400) as avg_duration_days
            FROM subscriptions s
            ${whereClause}
        `;

        const result = await pool.query(query, params);
        const stats = result.rows[0];

        // Get subscription breakdown by product
        const productBreakdownQuery = `
            SELECT 
                p.name as product_name,
                p.duration_days,
                COUNT(s.id) as subscription_count,
                COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_count
            FROM products p
            LEFT JOIN subscriptions s ON p.id = s.product_id ${userId ? 'AND s.user_id = $1' : ''}
            WHERE p.is_active = TRUE
            GROUP BY p.id, p.name, p.duration_days
            ORDER BY subscription_count DESC
        `;

        const productBreakdownResult = await pool.query(productBreakdownQuery, params);

        return {
            overview: {
                totalSubscriptions: parseInt(stats.total_subscriptions),
                activeSubscriptions: parseInt(stats.active_subscriptions),
                expiredSubscriptions: parseInt(stats.expired_subscriptions),
                inactiveSubscriptions: parseInt(stats.inactive_subscriptions),
                uniqueDevices: parseInt(stats.unique_devices),
                uniqueProducts: parseInt(stats.unique_products),
                avgDurationDays: parseFloat(stats.avg_duration_days) || 0
            },
            productBreakdown: productBreakdownResult.rows.map(row => ({
                productName: row.product_name,
                durationDays: row.duration_days,
                subscriptionCount: parseInt(row.subscription_count),
                activeCount: parseInt(row.active_count)
            }))
        };
    } catch (error) {
        logger.error('Error getting subscription stats:', error);
        throw new Error('Failed to get subscription statistics');
    }
};

/**
 * Admin: Get all subscriptions with filtering
 */
const adminGetAllSubscriptions = async (pool, filters = {}) => {
    try {
        const { 
            status = 'all', 
            productId, 
            userId, 
            hwid, 
            search,
            limit = 50, 
            offset = 0 
        } = filters;

        let whereConditions = [];
        let params = [];
        let paramCount = 1;

        // Build filters
        if (status === 'active') {
            whereConditions.push('s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP');
        } else if (status === 'expired') {
            whereConditions.push('(s.is_active = FALSE OR s.expires_at <= CURRENT_TIMESTAMP)');
        } else if (status === 'inactive') {
            whereConditions.push('s.is_active = FALSE');
        }

        if (productId) {
            whereConditions.push(`s.product_id = $${paramCount}`);
            params.push(productId);
            paramCount++;
        }

        if (userId) {
            whereConditions.push(`s.user_id = $${paramCount}`);
            params.push(userId);
            paramCount++;
        }

        if (hwid) {
            whereConditions.push(`s.hwid = $${paramCount}`);
            params.push(hwid);
            paramCount++;
        }

        if (search) {
            whereConditions.push(`(u.email ILIKE $${paramCount} OR p.name ILIKE $${paramCount} OR k.key_code ILIKE $${paramCount})`);
            params.push(`%${search}%`);
            paramCount++;
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const query = `
            SELECT 
                s.id,
                s.user_id,
                s.product_id,
                s.hwid,
                s.starts_at,
                s.expires_at,
                s.is_active,
                s.created_at,
                p.name as product_name,
                p.duration_days,
                p.price,
                k.key_code,
                u.email as user_email
            FROM subscriptions s
            JOIN products p ON s.product_id = p.id
            JOIN keys k ON s.key_id = k.id
            JOIN users u ON s.user_id = u.id
            ${whereClause}
            ORDER BY s.created_at DESC
            LIMIT $${paramCount} OFFSET $${paramCount + 1}
        `;

        params.push(limit, offset);
        const result = await pool.query(query, params);

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM subscriptions s
            JOIN products p ON s.product_id = p.id
            JOIN keys k ON s.key_id = k.id
            JOIN users u ON s.user_id = u.id
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, params.slice(0, -2));

        const subscriptions = result.rows.map(subscription => ({
            ...formatSubscription(subscription),
            userEmail: subscription.user_email,
            userId: subscription.user_id
        }));

        return {
            subscriptions,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(countResult.rows[0].total) > parseInt(offset) + parseInt(limit)
            }
        };
    } catch (error) {
        logger.error('Error fetching all subscriptions:', error);
        throw new Error('Failed to fetch subscriptions');
    }
};

/**
 * Admin: Deactivate subscription
 */
const adminDeactivateSubscription = async (pool, subscriptionId, adminId, reason = null) => {
    try {
        // Get subscription details before deactivating
        const subscriptionResult = await pool.query(
            `SELECT s.id, s.user_id, s.hwid, p.name as product_name, u.email
             FROM subscriptions s
             JOIN products p ON s.product_id = p.id
             JOIN users u ON s.user_id = u.id
             WHERE s.id = $1`,
            [subscriptionId]
        );

        if (subscriptionResult.rows.length === 0) {
            throw new Error('Subscription not found');
        }

        const subscription = subscriptionResult.rows[0];

        // Deactivate subscription
        const result = await pool.query(
            'UPDATE subscriptions SET is_active = FALSE WHERE id = $1 AND is_active = TRUE RETURNING *',
            [subscriptionId]
        );

        if (result.rows.length === 0) {
            throw new Error('Subscription not found or already inactive');
        }

        // Log the action
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
            [
                adminId,
                'ADMIN_SUBSCRIPTION_DEACTIVATED',
                JSON.stringify({
                    subscriptionId,
                    userEmail: subscription.email,
                    productName: subscription.product_name,
                    hwid: subscription.hwid,
                    reason
                })
            ]
        );

        return {
            message: 'Subscription deactivated successfully',
            subscription: {
                id: subscription.id,
                userEmail: subscription.email,
                productName: subscription.product_name,
                hwid: subscription.hwid
            }
        };
    } catch (error) {
        logger.error('Error deactivating subscription:', error);
        throw error;
    }
};

/**
 * Clean up expired subscriptions
 */
const cleanupExpiredSubscriptions = async (pool) => {
    try {
        const result = await pool.query(
            'UPDATE subscriptions SET is_active = FALSE WHERE expires_at <= CURRENT_TIMESTAMP AND is_active = TRUE RETURNING *'
        );

        logger.info(`Cleaned up ${result.rowCount} expired subscriptions`);

        return {
            message: `Cleaned up ${result.rowCount} expired subscriptions`,
            count: result.rowCount
        };
    } catch (error) {
        logger.error('Error cleaning up expired subscriptions:', error);
        throw new Error('Failed to cleanup expired subscriptions');
    }
};

module.exports = {
    formatSubscription,
    getUserSubscriptions,
    getSubscriptionById,
    checkHwidSubscription,
    getSubscriptionStats,
    adminGetAllSubscriptions,
    adminDeactivateSubscription,
    cleanupExpiredSubscriptions
};