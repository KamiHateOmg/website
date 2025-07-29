const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { authenticateToken, requireAdmin, optionalAuth, auditLog } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get all active products (public endpoint)
router.get('/', optionalAuth, async (req, res) => {
    const pool = req.app.locals.db;

    try {
        const result = await pool.query(
            `SELECT id, name, description, duration_days, price, is_featured, display_order, created_at
             FROM products 
             WHERE is_active = TRUE 
             ORDER BY display_order ASC, created_at ASC`
        );

        const products = result.rows.map(product => ({
            id: product.id,
            name: product.name,
            description: product.description,
            durationDays: product.duration_days,
            price: parseFloat(product.price),
            isFeatured: product.is_featured,
            displayOrder: product.display_order,
            createdAt: product.created_at,
            isLifetime: product.duration_days === 999999,
            priceFormatted: `$${parseFloat(product.price).toFixed(2)}`,
            durationText: product.duration_days === 999999 ? 'Lifetime' : 
                         product.duration_days === 1 ? '1 Day' :
                         product.duration_days < 30 ? `${product.duration_days} Days` :
                         product.duration_days < 365 ? `${Math.round(product.duration_days / 30)} Month${Math.round(product.duration_days / 30) > 1 ? 's' : ''}` :
                         `${Math.round(product.duration_days / 365)} Year${Math.round(product.duration_days / 365) > 1 ? 's' : ''}`
        }));

        res.json({
            products,
            total: products.length
        });

    } catch (error) {
        logger.error('Error fetching products:', error);
        res.status(500).json({
            error: 'Failed to fetch products'
        });
    }
});

// Get single product by ID
router.get('/:id', optionalAuth, async (req, res) => {
    const { id } = req.params;
    const pool = req.app.locals.db;

    try {
        const result = await pool.query(
            `SELECT id, name, description, duration_days, price, is_featured, display_order, created_at
             FROM products 
             WHERE id = $1 AND is_active = TRUE`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Product not found'
            });
        }

        const product = result.rows[0];

        res.json({
            id: product.id,
            name: product.name,
            description: product.description,
            durationDays: product.duration_days,
            price: parseFloat(product.price),
            isFeatured: product.is_featured,
            displayOrder: product.display_order,
            createdAt: product.created_at,
            isLifetime: product.duration_days === 999999,
            priceFormatted: `$${parseFloat(product.price).toFixed(2)}`,
            durationText: product.duration_days === 999999 ? 'Lifetime' : 
                         product.duration_days === 1 ? '1 Day' :
                         product.duration_days < 30 ? `${product.duration_days} Days` :
                         product.duration_days < 365 ? `${Math.round(product.duration_days / 30)} Month${Math.round(product.duration_days / 30) > 1 ? 's' : ''}` :
                         `${Math.round(product.duration_days / 365)} Year${Math.round(product.duration_days / 365) > 1 ? 's' : ''}`
        });

    } catch (error) {
        logger.error('Error fetching product:', error);
        res.status(500).json({
            error: 'Failed to fetch product'
        });
    }
});

// Purchase/Get product (creates a key for the user)
router.post('/:id/purchase', 
    authenticateToken,
    auditLog('PRODUCT_PURCHASE'),
    async (req, res) => {
        const { id } = req.params;
        const pool = req.app.locals.db;
        const userId = req.user.id;

        try {
            // Get product details
            const productResult = await pool.query(
                'SELECT id, name, description, duration_days, price, is_active FROM products WHERE id = $1',
                [id]
            );

            if (productResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            const product = productResult.rows[0];

            if (!product.is_active) {
                return res.status(400).json({
                    error: 'Product is not available'
                });
            }

            // For now, simulate payment success (all products are "free" for testing)
            // In a real implementation, you would integrate with Stripe/PayPal here

            // Generate a key for the user
            const { generateKeysForProduct } = require('../utils/keyGenerator');
            
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
                [userId, product.id, generatedKey.id, product.price, req.ip]
            );

            res.json({
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
            });

        } catch (error) {
            logger.error('Product purchase error:', error);
            res.status(500).json({
                error: 'Purchase failed'
            });
        }
    }
);

// Admin: Get all products (including inactive)
router.get('/admin/all', 
    authenticateToken, 
    requireAdmin,
    async (req, res) => {
        const pool = req.app.locals.db;

        try {
            const result = await pool.query(
                `SELECT id, name, description, duration_days, price, is_active, is_featured, 
                        display_order, created_at, updated_at
                 FROM products 
                 ORDER BY display_order ASC, created_at DESC`
            );

            const products = result.rows.map(product => ({
                id: product.id,
                name: product.name,
                description: product.description,
                durationDays: product.duration_days,
                price: parseFloat(product.price),
                isActive: product.is_active,
                isFeatured: product.is_featured,
                displayOrder: product.display_order,
                createdAt: product.created_at,
                updatedAt: product.updated_at,
                isLifetime: product.duration_days === 999999
            }));

            res.json({
                products,
                total: products.length
            });

        } catch (error) {
            logger.error('Error fetching all products:', error);
            res.status(500).json({
                error: 'Failed to fetch products'
            });
        }
    }
);

// Admin: Create new product
router.post('/admin', 
    authenticateToken,
    requireAdmin,
    auditLog('PRODUCT_CREATE'),
    [
        body('name').trim().isLength({ min: 1, max: 255 }).withMessage('Product name is required'),
        body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description too long'),
        body('durationDays').isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
        body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('displayOrder').optional().isInt({ min: 0 }).withMessage('Display order must be a non-negative integer')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { name, description, durationDays, price, displayOrder = 0, isFeatured = false } = req.body;
        const pool = req.app.locals.db;

        try {
            const result = await pool.query(
                `INSERT INTO products (name, description, duration_days, price, display_order, is_featured)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, name, description, duration_days, price, is_active, is_featured, display_order, created_at`,
                [name, description, durationDays, price, displayOrder, isFeatured]
            );

            const product = result.rows[0];

            res.status(201).json({
                message: 'Product created successfully',
                product: {
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    durationDays: product.duration_days,
                    price: parseFloat(product.price),
                    isActive: product.is_active,
                    isFeatured: product.is_featured,
                    displayOrder: product.display_order,
                    createdAt: product.created_at
                }
            });

        } catch (error) {
            logger.error('Product creation error:', error);
            res.status(500).json({
                error: 'Failed to create product'
            });
        }
    }
);

// Admin: Update product
router.put('/admin/:id',
    authenticateToken,
    requireAdmin,
    auditLog('PRODUCT_UPDATE'),
    [
        body('name').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Product name is required'),
        body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description too long'),
        body('durationDays').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
        body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('displayOrder').optional().isInt({ min: 0 }).withMessage('Display order must be a non-negative integer'),
        body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
        body('isFeatured').optional().isBoolean().withMessage('isFeatured must be a boolean')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { id } = req.params;
        const updates = req.body;
        const pool = req.app.locals.db;

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
                            updateFields.push(`is_featured = $${paramCount}`);
                            values.push(updates[key]);
                            paramCount++;
                            break;
                    }
                }
            });

            if (updateFields.length === 0) {
                return res.status(400).json({
                    error: 'No valid fields to update'
                });
            }

            values.push(id);

            const result = await pool.query(
                `UPDATE products SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $${paramCount}
                 RETURNING id, name, description, duration_days, price, is_active, is_featured, display_order, updated_at`,
                values
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            const product = result.rows[0];

            res.json({
                message: 'Product updated successfully',
                product: {
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    durationDays: product.duration_days,
                    price: parseFloat(product.price),
                    isActive: product.is_active,
                    isFeatured: product.is_featured,
                    displayOrder: product.display_order,
                    updatedAt: product.updated_at
                }
            });

        } catch (error) {
            logger.error('Product update error:', error);
            res.status(500).json({
                error: 'Failed to update product'
            });
        }
    }
);

// Admin: Delete product (soft delete)
router.delete('/admin/:id',
    authenticateToken,
    requireAdmin,
    auditLog('PRODUCT_DELETE'),
    async (req, res) => {
        const { id } = req.params;
        const pool = req.app.locals.db;

        try {
            const result = await pool.query(
                'UPDATE products SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING name',
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            res.json({
                message: `Product "${result.rows[0].name}" deactivated successfully`
            });

        } catch (error) {
            logger.error('Product deletion error:', error);
            res.status(500).json({
                error: 'Failed to delete product'
            });
        }
    }
);

// Admin: Get product statistics
router.get('/admin/:id/stats',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        const { id } = req.params;
        const pool = req.app.locals.db;

        try {
            // Get product info
            const productResult = await pool.query(
                'SELECT name FROM products WHERE id = $1',
                [id]
            );

            if (productResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            // Get key statistics
            const { getKeyStatistics } = require('../utils/keyGenerator');
            const keyStats = await getKeyStatistics(pool, id);

            // Get purchase statistics
            const purchaseStatsResult = await pool.query(
                `SELECT 
                    COUNT(*) as total_purchases,
                    SUM(amount) as total_revenue,
                    COUNT(DISTINCT user_id) as unique_buyers
                 FROM purchases 
                 WHERE product_id = $1 AND payment_status = 'completed'`,
                [id]
            );

            // Get active subscriptions count
            const activeSubsResult = await pool.query(
                `SELECT COUNT(*) as active_subscriptions
                 FROM subscriptions 
                 WHERE product_id = $1 AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP`,
                [id]
            );

            const purchaseStats = purchaseStatsResult.rows[0];
            const activeSubscriptions = parseInt(activeSubsResult.rows[0].active_subscriptions);

            res.json({
                productName: productResult.rows[0].name,
                keyStatistics: keyStats,
                purchaseStatistics: {
                    totalPurchases: parseInt(purchaseStats.total_purchases),
                    totalRevenue: parseFloat(purchaseStats.total_revenue) || 0,
                    uniqueBuyers: parseInt(purchaseStats.unique_buyers),
                    activeSubscriptions
                }
            });

        } catch (error) {
            logger.error('Error getting product statistics:', error);
            res.status(500).json({
                error: 'Failed to get product statistics'
            });
        }
    }
);

module.exports = router;