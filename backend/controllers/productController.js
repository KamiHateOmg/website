const logger = require('../utils/logger');
const { generateKeysForProduct } = require('../utils/keyGenerator');

/**
 * Format product for API response
 */
const formatProduct = (product) => {
    return {
        id: product.id,
        name: product.name,
        description: product.description,
        durationDays: product.duration_days,
        price: parseFloat(product.price),
        isFeatured: product.is_featured,
        displayOrder: product.display_order,
        createdAt: product.created_at,
        updatedAt: product.updated_at || undefined,
        isLifetime: product.duration_days === 999999,
        priceFormatted: `$${parseFloat(product.price).toFixed(2)}`,
        durationText: formatDurationText(product.duration_days)
    };
};

/**
 * Format duration days to human readable text
 */
const formatDurationText = (durationDays) => {
    if (durationDays === 999999) return 'Lifetime';
    if (durationDays === 1) return '1 Day';
    if (durationDays < 30) return `${durationDays} Days`;
    if (durationDays < 365) {
        const months = Math.round(durationDays / 30);
        return `${months} Month${months > 1 ? 's' : ''}`;
    }
    const years = Math.round(durationDays / 365);
    return `${years} Year${years > 1 ? 's' : ''}`;
};

/**
 * Get all active products (public endpoint)
 */
const getActiveProducts = async (pool) => {
    try {
        const result = await pool.query(
            `SELECT id, name, description, duration_days, price, is_featured, display_order, created_at
             FROM products 
             WHERE is_active = TRUE 
             ORDER BY display_order ASC, created_at ASC`
        );

        const products = result.rows.map(formatProduct);

        return {
            products,
            total: products.length
        };
    } catch (error) {
        logger.error('Error fetching products:', error);
        throw new Error('Failed to fetch products');
    }
};

/**
 * Get single product by ID
 */
const getProductById = async (pool, productId) => {
    try {
        const result = await pool.query(
            `SELECT id, name, description, duration_days, price, is_featured, display_order, created_at
             FROM products 
             WHERE id = $1 AND is_active = TRUE`,
            [productId]
        );

        if (result.rows.length === 0) {
            throw new Error('Product not found');
        }

        return formatProduct(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching product:', error);
        throw error;
    }
};

/**
 * Purchase/Get product (creates a key for the user)
 */
const purchaseProduct = async (pool, productId, userId, ip) => {
    try {
        // Get product details
        const productResult = await pool.query(
            'SELECT id, name, description, duration_days, price, is_active FROM products WHERE id = $1',
            [productId]
        );

        if (productResult.rows.length === 0) {
            throw new Error('Product not found');
        }

        const product = productResult.rows[0];

        if (!product.is_active) {
            throw new Error('Product is not available');
        }

        // For now, simulate payment success (all products are "free" for testing)
        // In a real implementation, you would integrate with Stripe/PayPal here

        // Generate a key for the user
        const keys = await generateKeysForProduct(pool, product.id, 1, userId);
        const generatedKey = keys[0];

        // Mark the key as purchased by this user
        await pool.query(
            'UPDATE keys SET purchased_by = $1 WHERE id = $2',
            [userId, generatedKey.id]
        );

        // Create purchase record
        await pool.query(
            `INSERT INTO purchases (user_id, product_id, key_id, amount, payment_method, payment_status, ip_address)
             VALUES ($1, $2, $3, $4, 'simulation', 'completed', $5)`,
            [userId, product.id, generatedKey.id, product.price, ip]
        );

        return {
            success: true,
            message: 'Product purchased successfully',
            purchase: {
                productId: product.id,
                productName: product.name,
                durationDays: product.duration_days,
                price: parseFloat(product.price),
                keyCode: generatedKey.keyCode,
                purchasedAt: new Date()
            },
            key: {
                code: generatedKey.keyCode,
                instructions: 'Go to your dashboard to redeem this key and activate your subscription.'
            }
        };
    } catch (error) {
        logger.error('Product purchase error:', error);
        throw error;
    }
};

/**
 * Admin: Get all products (including inactive)
 */
const adminGetAllProducts = async (pool) => {
    try {
        const result = await pool.query(
            `SELECT id, name, description, duration_days, price, is_active, is_featured, 
                    display_order, created_at, updated_at
             FROM products 
             ORDER BY display_order ASC, created_at DESC`
        );

        const products = result.rows.map(product => ({
            ...formatProduct(product),
            isActive: product.is_active
        }));

        return {
            products,
            total: products.length
        };
    } catch (error) {
        logger.error('Error fetching all products:', error);
        throw new Error('Failed to fetch products');
    }
};

/**
 * Admin: Create new product
 */
const adminCreateProduct = async (pool, productData) => {
    try {
        const { name, description, durationDays, price, displayOrder = 0, isFeatured = false } = productData;

        const result = await pool.query(
            `INSERT INTO products (name, description, duration_days, price, display_order, is_featured)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, description, duration_days, price, is_active, is_featured, display_order, created_at`,
            [name, description, durationDays, price, displayOrder, isFeatured]
        );

        const product = result.rows[0];

        return {
            message: 'Product created successfully',
            product: {
                ...formatProduct(product),
                isActive: product.is_active
            }
        };
    } catch (error) {
        logger.error('Product creation error:', error);
        throw new Error('Failed to create product');
    }
};

/**
 * Admin: Update product
 */
const adminUpdateProduct = async (pool, productId, updates) => {
    try {
        // Build dynamic update query
        const updateFields = [];
        const values = [];
        let paramCount = 1;

        Object.keys(updates).forEach(key => {
            if (updates[key] !== undefined) {
                switch (key) {
                    case 'name':
                        updateFields.push(`name = $${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                    case 'description':
                        updateFields.push(`description = $${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                    case 'durationDays':
                        updateFields.push(`duration_days = $${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                    case 'price':
                        updateFields.push(`price = $${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                    case 'displayOrder':
                        updateFields.push(`display_order = $${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                    case 'isActive':
                        updateFields.push(`is_active = $${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                    case 'isFeatured':
                        updateFields.push(`is_featured = ${paramCount}`);
                        values.push(updates[key]);
                        paramCount++;
                        break;
                }
            }
        });

        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(productId);

        const result = await pool.query(
            `UPDATE products SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = ${paramCount}
             RETURNING id, name, description, duration_days, price, is_active, is_featured, display_order, updated_at`,
            values
        );

        if (result.rows.length === 0) {
            throw new Error('Product not found');
        }

        const product = result.rows[0];

        return {
            message: 'Product updated successfully',
            product: {
                ...formatProduct(product),
                isActive: product.is_active
            }
        };
    } catch (error) {
        logger.error('Product update error:', error);
        throw error;
    }
};

/**
 * Admin: Delete product (soft delete)
 */
const adminDeleteProduct = async (pool, productId) => {
    try {
        const result = await pool.query(
            'UPDATE products SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING name',
            [productId]
        );

        if (result.rows.length === 0) {
            throw new Error('Product not found');
        }

        return {
            message: `Product "${result.rows[0].name}" deactivated successfully`
        };
    } catch (error) {
        logger.error('Product deletion error:', error);
        throw error;
    }
};

/**
 * Admin: Get product statistics
 */
const adminGetProductStats = async (pool, productId) => {
    try {
        // Get product info
        const productResult = await pool.query(
            'SELECT name FROM products WHERE id = $1',
            [productId]
        );

        if (productResult.rows.length === 0) {
            throw new Error('Product not found');
        }

        // Get key statistics
        const { getKeyStatistics } = require('../utils/keyGenerator');
        const keyStats = await getKeyStatistics(pool, productId);

        // Get purchase statistics
        const purchaseStatsResult = await pool.query(
            `SELECT 
                COUNT(*) as total_purchases,
                SUM(amount) as total_revenue,
                COUNT(DISTINCT user_id) as unique_buyers
             FROM purchases 
             WHERE product_id = $1 AND payment_status = 'completed'`,
            [productId]
        );

        // Get active subscriptions count
        const activeSubsResult = await pool.query(
            `SELECT COUNT(*) as active_subscriptions
             FROM subscriptions 
             WHERE product_id = $1 AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP`,
            [productId]
        );

        const purchaseStats = purchaseStatsResult.rows[0];
        const activeSubscriptions = parseInt(activeSubsResult.rows[0].active_subscriptions);

        return {
            productName: productResult.rows[0].name,
            keyStatistics: keyStats,
            purchaseStatistics: {
                totalPurchases: parseInt(purchaseStats.total_purchases),
                totalRevenue: parseFloat(purchaseStats.total_revenue) || 0,
                uniqueBuyers: parseInt(purchaseStats.unique_buyers),
                activeSubscriptions
            }
        };
    } catch (error) {
        logger.error('Error getting product statistics:', error);
        throw error;
    }
};

module.exports = {
    formatProduct,
    formatDurationText,
    getActiveProducts,
    getProductById,
    purchaseProduct,
    adminGetAllProducts,
    adminCreateProduct,
    adminUpdateProduct,
    adminDeleteProduct,
    adminGetProductStats
};