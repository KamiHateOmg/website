const logger = require('../utils/logger');

class Product {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Create a new product
     */
    async create(productData) {
        const { name, description, durationDays, price, displayOrder = 0, isFeatured = false } = productData;

        // Validate required fields
        if (!name || !durationDays || price === undefined) {
            throw new Error('Name, duration days, and price are required');
        }

        if (durationDays < 1) {
            throw new Error('Duration must be at least 1 day');
        }

        if (price < 0) {
            throw new Error('Price cannot be negative');
        }

        try {
            const result = await this.pool.query(
                `INSERT INTO products (name, description, duration_days, price, display_order, is_featured)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, name, description, duration_days, price, is_active, is_featured, display_order, created_at`,
                [name, description, durationDays, price, displayOrder, isFeatured]
            );

            const product = result.rows[0];
            return this.formatProduct(product);

        } catch (error) {
            logger.error('Error creating product:', error);
            throw error;
        }
    }

    /**
     * Get all active products (public)
     */
    async getAllActive() {
        try {
            const result = await this.pool.query(
                `SELECT id, name, description, duration_days, price, is_featured, display_order, created_at
                 FROM products 
                 WHERE is_active = TRUE 
                 ORDER BY display_order ASC, created_at ASC`
            );

            return result.rows.map(product => this.formatProduct(product));

        } catch (error) {
            logger.error('Error getting active products:', error);
            throw error;
        }
    }

    /**
     * Get all products (admin)
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
                conditions.push(`is_active = $${paramCount}`);
                params.push(filters.isActive);
                paramCount++;
            }
            if (filters.isFeatured !== undefined) {
                conditions.push(`is_featured = $${paramCount}`);
                params.push(filters.isFeatured);
                paramCount++;
            }
            if (filters.search) {
                conditions.push(`name ILIKE $${paramCount}`);
                params.push(`%${filters.search}%`);
                paramCount++;
            }

            if (conditions.length > 0) {
                whereClause = `WHERE ${conditions.join(' AND ')}`;
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total FROM products ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get products
            const productsResult = await this.pool.query(
                `SELECT id, name, description, duration_days, price, is_active, is_featured, 
                        display_order, created_at, updated_at
                 FROM products ${whereClause}
                 ORDER BY display_order ASC, created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                [...params, limit, offset]
            );

            return {
                products: productsResult.rows.map(product => this.formatProduct(product)),
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
            logger.error('Error getting all products:', error);
            throw error;
        }
    }

    /**
     * Get product by ID
     */
    async findById(productId) {
        try {
            const result = await this.pool.query(
                `SELECT id, name, description, duration_days, price, is_active, is_featured, 
                        display_order, created_at, updated_at
                 FROM products WHERE id = $1`,
                [productId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.formatProduct(result.rows[0]);

        } catch (error) {
            logger.error('Error finding product by ID:', error);
            throw error;
        }
    }

    /**
     * Get active product by ID
     */
    async findActiveById(productId) {
        try {
            const result = await this.pool.query(
                `SELECT id, name, description, duration_days, price, is_featured, display_order, created_at
                 FROM products WHERE id = $1 AND is_active = TRUE`,
                [productId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.formatProduct(result.rows[0]);

        } catch (error) {
            logger.error('Error finding active product by ID:', error);
            throw error;
        }
    }

    /**
     * Update product
     */
    async update(productId, updates) {
        try {
            const allowedFields = ['name', 'description', 'duration_days', 'price', 'display_order', 'is_active', 'is_featured'];
            const updateFields = [];
            const values = [];
            let paramCount = 1;

            Object.keys(updates).forEach(key => {
                const dbField = this.camelToSnake(key);
                if (allowedFields.includes(dbField) && updates[key] !== undefined) {
                    updateFields.push(`${dbField} = $${paramCount}`);
                    values.push(updates[key]);
                    paramCount++;
                }
            });

            if (updateFields.length === 0) {
                throw new Error('No valid fields to update');
            }

            // Validate duration and price if being updated
            if (updates.durationDays && updates.durationDays < 1) {
                throw new Error('Duration must be at least 1 day');
            }
            if (updates.price !== undefined && updates.price < 0) {
                throw new Error('Price cannot be negative');
            }

            values.push(productId);

            const result = await this.pool.query(
                `UPDATE products 
                 SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $${paramCount}
                 RETURNING id, name, description, duration_days, price, is_active, is_featured, display_order, updated_at`,
                values
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.formatProduct(result.rows[0]);

        } catch (error) {
            logger.error('Error updating product:', error);
            throw error;
        }
    }

    /**
     * Delete product (soft delete)
     */
    async delete(productId) {
        try {
            const result = await this.pool.query(
                `UPDATE products 
                 SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1 
                 RETURNING name`,
                [productId]
            );

            return result.rows[0] || null;

        } catch (error) {
            logger.error('Error deleting product:', error);
            throw error;
        }
    }

    /**
     * Get product statistics
     */
    async getStatistics(productId = null) {
        try {
            let whereClause = '';
            let params = [];

            if (productId) {
                whereClause = 'WHERE p.id = $1';
                params = [productId];
            }

            const result = await this.pool.query(
                `SELECT 
                    p.id,
                    p.name,
                    COUNT(k.id) as total_keys,
                    COUNT(CASE WHEN k.redeemed_by IS NULL AND k.is_active = TRUE 
                              AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP) 
                              THEN 1 END) as available_keys,
                    COUNT(CASE WHEN k.redeemed_by IS NOT NULL THEN 1 END) as redeemed_keys,
                    COUNT(s.id) as total_subscriptions,
                    COUNT(CASE WHEN s.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP 
                              THEN 1 END) as active_subscriptions,
                    COALESCE(SUM(pu.amount), 0) as total_revenue
                 FROM products p
                 LEFT JOIN keys k ON p.id = k.product_id
                 LEFT JOIN subscriptions s ON p.id = s.product_id
                 LEFT JOIN purchases pu ON p.id = pu.product_id AND pu.payment_status = 'completed'
                 ${whereClause}
                 GROUP BY p.id, p.name
                 ORDER BY p.display_order ASC, p.name ASC`,
                params
            );

            if (productId) {
                return result.rows[0] || null;
            }

            return result.rows;

        } catch (error) {
            logger.error('Error getting product statistics:', error);
            throw error;
        }
    }

    /**
     * Get featured products
     */
    async getFeatured() {
        try {
            const result = await this.pool.query(
                `SELECT id, name, description, duration_days, price, display_order, created_at
                 FROM products 
                 WHERE is_active = TRUE AND is_featured = TRUE
                 ORDER BY display_order ASC, created_at ASC`
            );

            return result.rows.map(product => this.formatProduct(product));

        } catch (error) {
            logger.error('Error getting featured products:', error);
            throw error;
        }
    }

    /**
     * Check if product exists and is active
     */
    async exists(productId) {
        try {
            const result = await this.pool.query(
                'SELECT id FROM products WHERE id = $1 AND is_active = TRUE',
                [productId]
            );

            return result.rows.length > 0;

        } catch (error) {
            logger.error('Error checking if product exists:', error);
            throw error;
        }
    }

    /**
     * Get product purchase history
     */
    async getPurchaseHistory(productId, page = 1, limit = 50) {
        try {
            const offset = (page - 1) * limit;

            // Get total count
            const countResult = await this.pool.query(
                'SELECT COUNT(*) as total FROM purchases WHERE product_id = $1',
                [productId]
            );
            const total = parseInt(countResult.rows[0].total);

            // Get purchases
            const purchasesResult = await this.pool.query(
                `SELECT p.id, p.amount, p.payment_method, p.payment_status, p.created_at,
                        u.email as user_email, k.key_code
                 FROM purchases p
                 JOIN users u ON p.user_id = u.id
                 JOIN keys k ON p.key_id = k.id
                 WHERE p.product_id = $1
                 ORDER BY p.created_at DESC
                 LIMIT $2 OFFSET $3`,
                [productId, limit, offset]
            );

            return {
                purchases: purchasesResult.rows,
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
            logger.error('Error getting product purchase history:', error);
            throw error;
        }
    }

    /**
     * Format product for API response
     */
    formatProduct(product) {
        return {
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
            isLifetime: product.duration_days === 999999,
            priceFormatted: `$${parseFloat(product.price).toFixed(2)}`,
            durationText: this.formatDuration(product.duration_days)
        };
    }

    /**
     * Format duration for display
     */
    formatDuration(days) {
        if (days === 999999) return 'Lifetime';
        if (days === 1) return '1 Day';
        if (days < 30) return `${days} Days`;
        if (days < 365) {
            const months = Math.round(days / 30);
            return `${months} Month${months > 1 ? 's' : ''}`;
        }
        const years = Math.round(days / 365);
        return `${years} Year${years > 1 ? 's' : ''}`;
    }

    /**
     * Convert camelCase to snake_case
     */
    camelToSnake(str) {
        return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }

    /**
     * Validate product data
     */
    validate(productData) {
        const errors = [];

        if (!productData.name || productData.name.trim().length === 0) {
            errors.push('Product name is required');
        }

        if (productData.name && productData.name.length > 255) {
            errors.push('Product name must be 255 characters or less');
        }

        if (productData.description && productData.description.length > 1000) {
            errors.push('Description must be 1000 characters or less');
        }

        if (!productData.durationDays || productData.durationDays < 1) {
            errors.push('Duration must be at least 1 day');
        }

        if (productData.price === undefined || productData.price < 0) {
            errors.push('Price must be 0 or greater');
        }

        if (productData.displayOrder !== undefined && productData.displayOrder < 0) {
            errors.push('Display order must be 0 or greater');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = Product;