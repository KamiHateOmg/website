const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const router = express.Router();

// Email transporter setup
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Validation rules
const registerValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Password confirmation does not match password');
        }
        return true;
    })
];

const loginValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('hwid').optional().isLength({ min: 10, max: 255 }).withMessage('Invalid HWID format')
];

// Helper function to generate JWT
const generateToken = (userId, email, role) => {
    return jwt.sign(
        { userId, email, role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// Helper function to log authentication attempts
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

// Helper function to log audit events
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

// Register endpoint
router.post('/register', registerValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }

    const { email, password } = req.body;
    const pool = req.app.locals.db;

    try {
        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            await logAuthAttempt(pool, email, req.ip, false, req.get('User-Agent'));
            return res.status(409).json({
                error: 'User with this email already exists'
            });
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
        await logAuditEvent(pool, newUser.id, 'USER_REGISTERED', { email }, req.ip);
        await logAuthAttempt(pool, email, req.ip, true, req.get('User-Agent'));

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: newUser.id,
                email: newUser.email,
                role: newUser.role,
                emailVerified: newUser.email_verified,
                createdAt: newUser.created_at
            },
            requiresEmailVerification: true
        });

    } catch (error) {
        logger.error('Registration error:', error);
        await logAuthAttempt(pool, email, req.ip, false, req.get('User-Agent'));
        res.status(500).json({
            error: 'Registration failed'
        });
    }
});

// Login endpoint
router.post('/login', loginValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }

    const { email, password, hwid } = req.body;
    const pool = req.app.locals.db;

    try {
        // Get user
        const userResult = await pool.query(
            'SELECT id, email, password_hash, role, hwid, email_verified, is_active, last_login FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            await logAuthAttempt(pool, email, req.ip, false, req.get('User-Agent'));
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        const user = userResult.rows[0];

        // Check if user is active
        if (!user.is_active) {
            await logAuthAttempt(pool, email, req.ip, false, req.get('User-Agent'));
            return res.status(401).json({
                error: 'Account is disabled'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            await logAuthAttempt(pool, email, req.ip, false, req.get('User-Agent'));
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Update HWID if provided and different
        if (hwid && hwid !== user.hwid) {
            await pool.query(
                'UPDATE users SET hwid = $1 WHERE id = $2',
                [hwid, user.id]
            );
            await logAuditEvent(pool, user.id, 'HWID_UPDATED', { oldHwid: user.hwid, newHwid: hwid }, req.ip);
        }

        // Update last login
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP, last_ip = $1 WHERE id = $2',
            [req.ip, user.id]
        );

        // Generate token
        const token = generateToken(user.id, user.email, user.role);

        // Log successful login
        await logAuditEvent(pool, user.id, 'USER_LOGIN', { ip: req.ip, hwid }, req.ip);
        await logAuthAttempt(pool, email, req.ip, true, req.get('User-Agent'));

        res.json({
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
        });

    } catch (error) {
        logger.error('Login error:', error);
        await logAuthAttempt(pool, email, req.ip, false, req.get('User-Agent'));
        res.status(500).json({
            error: 'Login failed'
        });
    }
});

// Email verification endpoint
router.get('/verify-email/:token', async (req, res) => {
    const { token } = req.params;
    const pool = req.app.locals.db;

    try {
        const result = await pool.query(
            'SELECT id, email FROM users WHERE email_verification_token = $1 AND email_verified = FALSE',
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({
                error: 'Invalid or expired verification token'
            });
        }

        const user = result.rows[0];

        // Mark email as verified
        await pool.query(
            'UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE id = $1',
            [user.id]
        );

        // Log verification
        await logAuditEvent(pool, user.id, 'EMAIL_VERIFIED', {}, req.ip);

        res.json({
            message: 'Email verified successfully'
        });

    } catch (error) {
        logger.error('Email verification error:', error);
        res.status(500).json({
            error: 'Email verification failed'
        });
    }
});

// Password reset request
router.post('/forgot-password', [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }

    const { email } = req.body;
    const pool = req.app.locals.db;

    try {
        const user = await pool.query(
            'SELECT id, email FROM users WHERE email = $1 AND is_active = TRUE',
            [email]
        );

        // Always return success to prevent email enumeration
        if (user.rows.length === 0) {
            return res.json({
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
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

        await logAuditEvent(pool, user.rows[0].id, 'PASSWORD_RESET_REQUESTED', {}, req.ip);

        res.json({
            message: 'If an account with that email exists, a password reset link has been sent.'
        });

    } catch (error) {
        logger.error('Password reset request error:', error);
        res.status(500).json({
            error: 'Password reset request failed'
        });
    }
});

// Password reset
router.post('/reset-password', [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }

    const { token, password } = req.body;
    const pool = req.app.locals.db;

    try {
        const user = await pool.query(
            'SELECT id, email FROM users WHERE password_reset_token = $1 AND password_reset_expires > CURRENT_TIMESTAMP',
            [token]
        );

        if (user.rows.length === 0) {
            return res.status(400).json({
                error: 'Invalid or expired reset token'
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        await pool.query(
            'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
            [passwordHash, user.rows[0].id]
        );

        await logAuditEvent(pool, user.rows[0].id, 'PASSWORD_RESET_COMPLETED', {}, req.ip);

        res.json({
            message: 'Password reset successfully'
        });

    } catch (error) {
        logger.error('Password reset error:', error);
        res.status(500).json({
            error: 'Password reset failed'
        });
    }
});

// Logout endpoint (mainly for logging)
router.post('/logout', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const pool = req.app.locals.db;
            
            await logAuditEvent(pool, decoded.userId, 'USER_LOGOUT', {}, req.ip);
        } catch (error) {
            // Invalid token, but still return success
        }
    }

    res.json({
        message: 'Logged out successfully'
    });
});

// Validate token endpoint
router.get('/validate', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            error: 'No token provided'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const pool = req.app.locals.db;

        // Check if user still exists and is active
        const user = await pool.query(
            'SELECT id, email, role, email_verified, is_active FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (user.rows.length === 0 || !user.rows[0].is_active) {
            return res.status(401).json({
                error: 'Invalid token'
            });
        }

        res.json({
            valid: true,
            user: {
                id: user.rows[0].id,
                email: user.rows[0].email,
                role: user.rows[0].role,
                emailVerified: user.rows[0].email_verified
            }
        });

    } catch (error) {
        res.status(401).json({
            error: 'Invalid token'
        });
    }
});

module.exports = router;