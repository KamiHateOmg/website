const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Email transporter setup
const transporter = nodemailer.createTransporter({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Generate JWT token
 */
const generateToken = (userId, email, role) => {
    return jwt.sign(
        { userId, email, role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

/**
 * Log authentication attempts
 */
const logAuthAttempt = async (pool, email, ip, success, userAgent = null) => {
    try {
        await pool.query(
            'INSERT INTO login_attempts (email, ip_address, success, user_agent) VALUES ($1, $2, $3, $4)',
            [email, ip, success, userAgent]
        );
    } catch (error) {
        logger.error('Failed to log auth attempt:', error);
    }
};

/**
 * Log audit events
 */
const logAuditEvent = async (pool, userId, action, details, ip) => {
    try {
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
            [userId, action, JSON.stringify(details), ip]
        );
    } catch (error) {
        logger.error('Failed to log audit event:', error);
    }
};

/**
 * Register a new user
 */
const registerUser = async (pool, userData, ip, userAgent) => {
    try {
        const { email, password } = userData;

        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            await logAuthAttempt(pool, email, ip, false, userAgent);
            throw new Error('User with this email already exists');
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Generate email verification token
        const emailVerificationToken = crypto.randomBytes(32).toString('hex');

        // Create user
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, email_verification_token) 
             VALUES ($1, $2, $3) RETURNING id, email, role, email_verified, created_at`,
            [email, passwordHash, emailVerificationToken]
        );

        const newUser = result.rows[0];

        // Send verification email
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            try {
                const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/verify-email?token=${emailVerificationToken}`;
                
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: 'CS2 Loader - Verify Your Email',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #58A6FF;">Welcome to CS2 Loader!</h2>
                            <p>Thank you for registering. Please verify your email address by clicking the link below:</p>
                            <a href="${verificationUrl}" style="background-color: #58A6FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Verify Email</a>
                            <p style="margin-top: 20px; color: #666;">If you didn't create this account, please ignore this email.</p>
                            <p style="color: #666;">This link will expire in 24 hours.</p>
                        </div>
                    `
                });
            } catch (emailError) {
                logger.error('Failed to send verification email:', emailError);
                // Don't fail registration if email fails
            }
        }

        // Log successful registration
        await logAuditEvent(pool, newUser.id, 'USER_REGISTERED', { email }, ip);
        await logAuthAttempt(pool, email, ip, true, userAgent);

        return {
            message: 'User registered successfully',
            user: {
                id: newUser.id,
                email: newUser.email,
                role: newUser.role,
                emailVerified: newUser.email_verified,
                createdAt: newUser.created_at
            },
            requiresEmailVerification: true
        };
    } catch (error) {
        logger.error('Registration error:', error);
        await logAuthAttempt(pool, userData.email, ip, false, userAgent);
        throw error;
    }
};

/**
 * Login user
 */
const loginUser = async (pool, loginData, ip, userAgent) => {
    try {
        const { email, password, hwid } = loginData;

        // Get user
        const userResult = await pool.query(
            'SELECT id, email, password_hash, role, hwid, email_verified, is_active, last_login FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            await logAuthAttempt(pool, email, ip, false, userAgent);
            throw new Error('Invalid credentials');
        }

        const user = userResult.rows[0];

        // Check if user is active
        if (!user.is_active) {
            await logAuthAttempt(pool, email, ip, false, userAgent);
            throw new Error('Account is disabled');
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            await logAuthAttempt(pool, email, ip, false, userAgent);
            throw new Error('Invalid credentials');
        }

        // Update HWID if provided and different
        if (hwid && hwid !== user.hwid) {
            await pool.query(
                'UPDATE users SET hwid = $1 WHERE id = $2',
                [hwid, user.id]
            );
            await logAuditEvent(pool, user.id, 'HWID_UPDATED', { oldHwid: user.hwid, newHwid: hwid }, ip);
        }

        // Update last login
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP, last_ip = $1 WHERE id = $2',
            [ip, user.id]
        );

        // Generate token
        const token = generateToken(user.id, user.email, user.role);

        // Log successful login
        await logAuditEvent(pool, user.id, 'USER_LOGIN', { ip, hwid }, ip);
        await logAuthAttempt(pool, email, ip, true, userAgent);

        return {
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.email_verified,
                hwid: hwid || user.hwid,
                lastLogin: user.last_login
            }
        };
    } catch (error) {
        logger.error('Login error:', error);
        await logAuthAttempt(pool, loginData.email, ip, false, userAgent);
        throw error;
    }
};

/**
 * Verify email with token
 */
const verifyEmail = async (pool, token, ip) => {
    try {
        const result = await pool.query(
            'SELECT id, email FROM users WHERE email_verification_token = $1 AND email_verified = FALSE',
            [token]
        );

        if (result.rows.length === 0) {
            throw new Error('Invalid or expired verification token');
        }

        const user = result.rows[0];

        // Mark email as verified
        await pool.query(
            'UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE id = $1',
            [user.id]
        );

        // Log verification
        await logAuditEvent(pool, user.id, 'EMAIL_VERIFIED', {}, ip);

        return {
            message: 'Email verified successfully'
        };
    } catch (error) {
        logger.error('Email verification error:', error);
        throw error;
    }
};

/**
 * Request password reset
 */
const requestPasswordReset = async (pool, email, ip) => {
    try {
        const user = await pool.query(
            'SELECT id, email FROM users WHERE email = $1 AND is_active = TRUE',
            [email]
        );

        // Always return success to prevent email enumeration
        if (user.rows.length === 0) {
            return {
                message: 'If an account with that email exists, a password reset link has been sent.'
            };
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 3600000); // 1 hour

        await pool.query(
            'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
            [resetToken, resetExpires, user.rows[0].id]
        );

        // Send reset email
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            try {
                const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/reset-password?token=${resetToken}`;
                
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: 'CS2 Loader - Password Reset',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #58A6FF;">Password Reset Request</h2>
                            <p>You have requested to reset your password. Click the link below to reset it:</p>
                            <a href="${resetUrl}" style="background-color: #58A6FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
                            <p style="margin-top: 20px; color: #666;">If you didn't request this, please ignore this email.</p>
                            <p style="color: #666;">This link will expire in 1 hour.</p>
                        </div>
                    `
                });
            } catch (emailError) {
                logger.error('Failed to send reset email:', emailError);
            }
        }

        await logAuditEvent(pool, user.rows[0].id, 'PASSWORD_RESET_REQUESTED', {}, ip);

        return {
            message: 'If an account with that email exists, a password reset link has been sent.'
        };
    } catch (error) {
        logger.error('Password reset request error:', error);
        throw new Error('Password reset request failed');
    }
};

/**
 * Reset password with token
 */
const resetPassword = async (pool, token, newPassword, ip) => {
    try {
        const user = await pool.query(
            'SELECT id, email FROM users WHERE password_reset_token = $1 AND password_reset_expires > CURRENT_TIMESTAMP',
            [token]
        );

        if (user.rows.length === 0) {
            throw new Error('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);

        await pool.query(
            'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
            [passwordHash, user.rows[0].id]
        );

        await logAuditEvent(pool, user.rows[0].id, 'PASSWORD_RESET_COMPLETED', {}, ip);

        return {
            message: 'Password reset successfully'
        };
    } catch (error) {
        logger.error('Password reset error:', error);
        throw error;
    }
};

/**
 * Logout user (for logging purposes)
 */
const logoutUser = async (pool, token, ip) => {
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            await logAuditEvent(pool, decoded.userId, 'USER_LOGOUT', {}, ip);
        } catch (error) {
            // Invalid token, but still return success
        }
    }

    return {
        message: 'Logged out successfully'
    };
};

/**
 * Validate JWT token and get user info
 */
const validateToken = async (pool, token) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if user still exists and is active
        const user = await pool.query(
            'SELECT id, email, role, email_verified, is_active FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (user.rows.length === 0 || !user.rows[0].is_active) {
            throw new Error('Invalid token');
        }

        return {
            valid: true,
            user: {
                id: user.rows[0].id,
                email: user.rows[0].email,
                role: user.rows[0].role,
                emailVerified: user.rows[0].email_verified
            }
        };
    } catch (error) {
        throw new Error('Invalid token');
    }
};

module.exports = {
    generateToken,
    logAuthAttempt,
    logAuditEvent,
    registerUser,
    loginUser,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    logoutUser,
    validateToken
};