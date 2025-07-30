const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../utils/logger');

class User {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Create a new user
     */
    async create(userData) {
        const { email, password, role = 'user' } = userData;
        
        // Validate email format
        if (!this.isValidEmail(email)) {
            throw new Error('Invalid email format');
        }

        // Validate password strength
        if (!this.isValidPassword(password)) {
            throw new Error('Password must be at least 8 characters with uppercase, lowercase, and number');
        }

        try {
            // Check if user already exists
            const existingUser = await this.pool.query(
                'SELECT id FROM users WHERE email = $1',
                [email]
            );

            if (existingUser.rows.length > 0) {
                throw new Error('User with this email already exists');
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 12);
            
            // Generate email verification token
            const emailVerificationToken = crypto.randomBytes(32).toString('hex');

            const result = await this.pool.query(
                `INSERT INTO users (email, password_hash, role, email_verification_token)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, email, role, email_verified, is_active, created_at`,
                [email, passwordHash, role, emailVerificationToken]
            );

            const user = result.rows[0];
            return {
                ...user,
                emailVerificationToken: role !== 'admin' ? emailVerificationToken : null
            };

        } catch (error) {
            logger.error('Error creating user:', error);
            throw error;
        }
    }

    /**
     * Find user by email
     */
    async findByEmail(email) {
        try {
            const result = await this.pool.query(
                `SELECT id, email, password_hash, role, hwid, email_verified, 
                        is_active, last_login, last_ip, created_at, updated_at
                 FROM users WHERE email = $1`,
                [email]
            );

            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error finding user by email:', error);
            throw error;
        }
    }

    /**
     * Find user by ID
     */
    async findById(userId) {
        try {
            const result = await this.pool.query(
                `SELECT id, email, role, hwid, email_verified, is_active, 
                        last_login, last_ip, created_at, updated_at
                 FROM users WHERE id = $1`,
                [userId]
            );

            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error finding user by ID:', error);
            throw error;
        }
    }

    /**
     * Verify user password
     */
    async verifyPassword(email, password) {
        try {
            const user = await this.findByEmail(email);
            if (!user) {
                return { success: false, user: null };
            }

            const isValid = await bcrypt.compare(password, user.password_hash);
            if (!isValid) {
                return { success: false, user: null };
            }

            // Remove password hash from returned user
            delete user.password_hash;
            return { success: true, user };

        } catch (error) {
            logger.error('Error verifying password:', error);
            throw error;
        }
    }

    /**
     * Update user's HWID
     */
    async updateHWID(userId, hwid) {
        try {
            const result = await this.pool.query(
                'UPDATE users SET hwid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING hwid',
                [hwid, userId]
            );

            return result.rows[0];
        } catch (error) {
            logger.error('Error updating HWID:', error);
            throw error;
        }
    }

    /**
     * Update last login information
     */
    async updateLastLogin(userId, ipAddress) {
        try {
            await this.pool.query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP, last_ip = $1 WHERE id = $2',
                [ipAddress, userId]
            );
        } catch (error) {
            logger.error('Error updating last login:', error);
            throw error;
        }
    }

    /**
     * Verify email address
     */
    async verifyEmail(token) {
        try {
            const result = await this.pool.query(
                `UPDATE users 
                 SET email_verified = TRUE, email_verification_token = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE email_verification_token = $1 AND email_verified = FALSE
                 RETURNING id, email`,
                [token]
            );

            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error verifying email:', error);
            throw error;
        }
    }

    /**
     * Set password reset token
     */
    async setPasswordResetToken(email) {
        try {
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetExpires = new Date(Date.now() + 3600000); // 1 hour

            const result = await this.pool.query(
                `UPDATE users 
                 SET password_reset_token = $1, password_reset_expires = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE email = $3 AND is_active = TRUE
                 RETURNING id, email`,
                [resetToken, resetExpires, email]
            );

            if (result.rows.length > 0) {
                return { user: result.rows[0], resetToken };
            }
            return null;

        } catch (error) {
            logger.error('Error setting password reset token:', error);
            throw error;
        }
    }

    /**
     * Reset password using token
     */
    async resetPassword(token, newPassword) {
        try {
            // Validate password strength
            if (!this.isValidPassword(newPassword)) {
                throw new Error('Password must be at least 8 characters with uppercase, lowercase, and number');
            }

            const passwordHash = await bcrypt.hash(newPassword, 12);

            const result = await this.pool.query(
                `UPDATE users 
                 SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE password_reset_token = $2 AND password_reset_expires > CURRENT_TIMESTAMP
                 RETURNING id, email`,
                [passwordHash, token]
            );

            return result.rows[0] || null;

        } catch (error) {
            logger.error('Error resetting password:', error);
            throw error;
        }
    }

    /**
     * Update user profile
     */
    async updateProfile(userId, updates) {
        try {
            const allowedFields = ['email', 'role', 'is_active'];
            const updateFields = [];
            const values = [];
            let paramCount = 1;

            Object.keys(updates).forEach(key => {
                if (allowedFields.includes(key) && updates[key] !== undefined) {
                    updateFields.push(`${key} = $${paramCount}`);
                    values.push(updates[key]);
                    paramCount++;
                }
            });

            if (updateFields.length === 0) {
                throw new Error('No valid fields to update');
            }

            values.push(userId);

            const result = await this.pool.query(
                `UPDATE users 
                 SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $${paramCount}
                 RETURNING id, email, role, email_verified, is_active, updated_at`,
                values
            );

            return result.rows[0] || null;

        } catch (error) {
            logger.error('Error updating user profile:', error);
            throw error;
        }
    }

    /**
     * Get all users (admin function)
     */
    async getAll(page = 1, limit = 50, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let params = [];
            let paramCount = 1;

            // Build WHERE clause from filters
            const conditions = [];
            if (filters.role) {
                conditions.push(`role = $${paramCount}`);
                params.push(filters.role);
                paramCount++;
            }
            if (filters.isActive !== undefined) {
                conditions.push(`is_active = $${paramCount}`);
                params.push(filters.isActive);
                paramCount++;
            }
            if (filters.emailVerified !== undefined) {
                conditions.push(`email_verified = $${paramCount}`);
                params.push(filters.emailVerified);
                paramCount++;
            }
            if (filters.search) {
                conditions.push(`email ILIKE $${paramCount}`);
                params.push(`%${filters.search}%`);
                paramCount++;
            }

            if (conditions.length > 0) {
                whereClause = `WHERE ${conditions.join(' AND ')}`;
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total FROM users ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get users
            const usersResult = await this.pool.query(
                `SELECT id, email, role, hwid, email_verified, is_active, 
                        last_login, last_ip, created_at, updated_at
                 FROM users ${whereClause}
                 ORDER BY created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                [...params, limit, offset]
            );

            return {
                users: usersResult.rows,
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
            logger.error('Error getting all users:', error);
            throw error;
        }
    }

    /**
     * Get user statistics
     */
    async getStatistics() {
        try {
            const result = await this.pool.query(
                `SELECT 
                    COUNT(*) as total_users,
                    COUNT(CASE WHEN is_active = TRUE THEN 1 END) as active_users,
                    COUNT(CASE WHEN email_verified = TRUE THEN 1 END) as verified_users,
                    COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
                    COUNT(CASE WHEN role = 'staff' THEN 1 END) as staff_users,
                    COUNT(CASE WHEN last_login > CURRENT_TIMESTAMP - INTERVAL '30 days' THEN 1 END) as active_last_30_days
                 FROM users`
            );

            return result.rows[0];

        } catch (error) {
            logger.error('Error getting user statistics:', error);
            throw error;
        }
    }

    /**
     * Delete user (soft delete by deactivating)
     */
    async delete(userId) {
        try {
            const result = await this.pool.query(
                'UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING email',
                [userId]
            );

            return result.rows[0] || null;

        } catch (error) {
            logger.error('Error deleting user:', error);
            throw error;
        }
    }

    /**
     * Validate email format
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Validate password strength
     */
    isValidPassword(password) {
        // At least 8 characters, one uppercase, one lowercase, one number
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
        return passwordRegex.test(password);
    }

    /**
     * Find users by HWID
     */
    async findByHWID(hwid) {
        try {
            const result = await this.pool.query(
                'SELECT id, email, role, is_active FROM users WHERE hwid = $1',
                [hwid]
            );

            return result.rows;
        } catch (error) {
            logger.error('Error finding users by HWID:', error);
            throw error;
        }
    }

    /**
     * Check if user has permission for a specific action
     */
    hasPermission(userRole, requiredRole) {
        const roleHierarchy = {
            'user': 1,
            'staff': 2,
            'admin': 3
        };

        return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
    }
}

module.exports = User;