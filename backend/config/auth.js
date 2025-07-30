require('dotenv').config();

const authConfig = {
    // JWT Configuration
    jwt: {
        secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: process.env.JWT_ISSUER || 'cs2-loader',
        audience: process.env.JWT_AUDIENCE || 'cs2-loader-users',
        algorithm: 'HS256'
    },

    // Password Configuration
    password: {
        saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: false,
        
        // Password validation regex
        validationRegex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
        
        // Custom validation messages
        messages: {
            tooShort: 'Password must be at least 8 characters long',
            noUppercase: 'Password must contain at least one uppercase letter',
            noLowercase: 'Password must contain at least one lowercase letter',
            noNumbers: 'Password must contain at least one number',
            noSpecialChars: 'Password must contain at least one special character'
        }
    },

    // Session Configuration
    session: {
        name: 'cs2-loader-session',
        secret: process.env.SESSION_SECRET || 'your-session-secret-change-this-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            sameSite: 'strict'
        }
    },

    // Rate Limiting Configuration
    rateLimiting: {
        // General API rate limiting
        general: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // limit each IP to 100 requests per windowMs
            message: {
                error: 'Too many requests from this IP, please try again later.',
                retryAfter: '15 minutes'
            },
            standardHeaders: true,
            legacyHeaders: false
        },

        // Authentication endpoints rate limiting
        auth: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 5, // limit each IP to 5 auth requests per windowMs
            message: {
                error: 'Too many authentication attempts, please try again later.',
                retryAfter: '15 minutes'
            },
            skipSuccessfulRequests: true,
            skipFailedRequests: false
        },

        // Password reset rate limiting
        passwordReset: {
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 3, // limit each IP to 3 password reset requests per hour
            message: {
                error: 'Too many password reset attempts, please try again later.',
                retryAfter: '1 hour'
            }
        },

        // Key redemption rate limiting
        keyRedemption: {
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 10, // limit each IP to 10 key redemption attempts per hour
            message: {
                error: 'Too many key redemption attempts, please try again later.',
                retryAfter: '1 hour'
            }
        }
    },

    // Account Lockout Configuration
    lockout: {
        maxAttempts: 5,
        lockoutDuration: 30 * 60 * 1000, // 30 minutes
        incrementalDelay: true, // Increase delay with each failed attempt
        resetOnSuccess: true
    },

    // Email Verification Configuration
    emailVerification: {
        tokenLength: 32,
        expiresIn: 24 * 60 * 60 * 1000, // 24 hours
        required: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
        resendDelay: 5 * 60 * 1000 // 5 minutes between resend attempts
    },

    // Password Reset Configuration
    passwordReset: {
        tokenLength: 32,
        expiresIn: 60 * 60 * 1000, // 1 hour
        maxResetAttempts: 3,
        resetWindow: 24 * 60 * 60 * 1000 // 24 hours
    },

    // HWID Configuration
    hwid: {
        required: true,
        maxLength: 255,
        minLength: 10,
        validationRegex: /^[A-Za-z0-9-_]{10,255}$/,
        allowUpdate: true, // Allow users to update their HWID
        lockAfterRedemption: true, // Lock HWID after key redemption
        
        // HWID validation messages
        messages: {
            required: 'Hardware ID is required',
            invalid: 'Invalid hardware ID format',
            tooShort: 'Hardware ID must be at least 10 characters',
            tooLong: 'Hardware ID must be less than 255 characters',
            locked: 'This hardware ID is locked to another account'
        }
    },

    // Role-based Access Control
    roles: {
        user: {
            level: 1,
            permissions: ['read_own_profile', 'update_own_profile', 'redeem_keys', 'view_own_subscriptions']
        },
        staff: {
            level: 2,
            permissions: [
                'read_own_profile', 'update_own_profile', 'redeem_keys', 'view_own_subscriptions',
                'view_users', 'view_keys', 'view_subscriptions', 'generate_keys', 'view_analytics'
            ]
        },
        admin: {
            level: 3,
            permissions: [
                'read_own_profile', 'update_own_profile', 'redeem_keys', 'view_own_subscriptions',
                'view_users', 'create_users', 'update_users', 'delete_users',
                'view_keys', 'generate_keys', 'deactivate_keys',
                'view_subscriptions', 'manage_subscriptions',
                'view_analytics', 'system_maintenance', 'audit_logs', 'manage_products'
            ]
        }
    },

    // API Key Configuration (for desktop app)
    apiKeys: {
        length: 64,
        prefix: 'cs2_',
        expiresIn: null, // null = never expires
        rotationInterval: 90 * 24 * 60 * 60 * 1000, // 90 days (optional)
        
        // API key validation
        validationRegex: /^cs2_[A-Za-z0-9]{64}$/,
        
        // Rate limiting for API key usage
        rateLimiting: {
            windowMs: 60 * 1000, // 1 minute
            max: 60, // 60 requests per minute per API key
            message: {
                error: 'API rate limit exceeded',
                retryAfter: '1 minute'
            }
        }
    },

    // Security Headers Configuration
    security: {
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                    scriptSrc: ["'self'"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    frameAncestors: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"]
                }
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        }
    },

    // CORS Configuration
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:8080',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
        maxAge: 86400 // 24 hours
    },

    // Audit Logging Configuration
    audit: {
        enabled: true,
        actions: {
            // Authentication events
            USER_LOGIN: { level: 'info', retention: 90 },
            USER_LOGOUT: { level: 'info', retention: 30 },
            USER_REGISTER: { level: 'info', retention: 365 },
            LOGIN_FAILED: { level: 'warn', retention: 30 },
            PASSWORD_RESET_REQUESTED: { level: 'info', retention: 90 },
            PASSWORD_RESET_COMPLETED: { level: 'info', retention: 90 },
            EMAIL_VERIFIED: { level: 'info', retention: 365 },
            
            // Key management events
            KEY_GENERATED: { level: 'info', retention: 365 },
            KEY_REDEEMED: { level: 'info', retention: 365 },
            KEY_DEACTIVATED: { level: 'warn', retention: 365 },
            BULK_KEY_GENERATION: { level: 'info', retention: 365 },
            
            // Subscription events
            SUBSCRIPTION_CREATED: { level: 'info', retention: 365 },
            SUBSCRIPTION_EXPIRED: { level: 'info', retention: 180 },
            SUBSCRIPTION_RENEWED: { level: 'info', retention: 365 },
            
            // Admin events
            ADMIN_LOGIN: { level: 'info', retention: 365 },
            ADMIN_USER_CREATED: { level: 'warn', retention: 365 },
            ADMIN_BULK_KEY_GENERATION: { level: 'warn', retention: 365 },
            ADMIN_SYSTEM_CLEANUP: { level: 'warn', retention: 365 },
            ADMIN_USER_DATA_EXPORT: { level: 'warn', retention: 365 },
            
            // System events
            SYSTEM_STARTUP: { level: 'info', retention: 90 },
            SYSTEM_SHUTDOWN: { level: 'info', retention: 90 },
            DATABASE_ERROR: { level: 'error', retention: 365 },
            
            // Security events
            SUSPICIOUS_LOGIN: { level: 'warn', retention: 365 },
            RATE_LIMIT_EXCEEDED: { level: 'warn', retention: 30 },
            INVALID_TOKEN: { level: 'warn', retention: 30 },
            HWID_MISMATCH: { level: 'warn', retention: 90 },
            
            // Desktop app events
            DESKTOP_AUTH_CHECK: { level: 'debug', retention: 7 },
            DESKTOP_SUBSCRIPTION_ACCESS: { level: 'info', retention: 30 }
        },
        
        // Retention policy (days)
        retention: {
            debug: 7,
            info: 90,
            warn: 180,
            error: 365
        }
    },

    // Two-Factor Authentication (future implementation)
    twoFactor: {
        enabled: false,
        issuer: 'CS2 Loader',
        window: 2, // Allow 2 time steps
        step: 30, // 30 second time step
        digits: 6,
        algorithm: 'sha1'
    },

    // Webhook Configuration (for external integrations)
    webhooks: {
        enabled: process.env.WEBHOOKS_ENABLED === 'true',
        secret: process.env.WEBHOOK_SECRET,
        events: [
            'user.registered',
            'key.redeemed',
            'subscription.created',
            'subscription.expired'
        ],
        retryAttempts: 3,
        retryDelay: 5000, // 5 seconds
        timeout: 10000 // 10 seconds
    }
};

// Validation functions
const validatePassword = (password) => {
    const errors = [];
    
    if (password.length < authConfig.password.minLength) {
        errors.push(authConfig.password.messages.tooShort);
    }
    
    if (authConfig.password.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push(authConfig.password.messages.noUppercase);
    }
    
    if (authConfig.password.requireLowercase && !/[a-z]/.test(password)) {
        errors.push(authConfig.password.messages.noLowercase);
    }
    
    if (authConfig.password.requireNumbers && !/\d/.test(password)) {
        errors.push(authConfig.password.messages.noNumbers);
    }
    
    if (authConfig.password.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        errors.push(authConfig.password.messages.noSpecialChars);
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

const validateHwid = (hwid) => {
    if (!hwid) {
        return {
            isValid: false,
            error: authConfig.hwid.messages.required
        };
    }
    
    if (hwid.length < authConfig.hwid.minLength) {
        return {
            isValid: false,
            error: authConfig.hwid.messages.tooShort
        };
    }
    
    if (hwid.length > authConfig.hwid.maxLength) {
        return {
            isValid: false,
            error: authConfig.hwid.messages.tooLong
        };
    }
    
    if (!authConfig.hwid.validationRegex.test(hwid)) {
        return {
            isValid: false,
            error: authConfig.hwid.messages.invalid
        };
    }
    
    return { isValid: true };
};

const hasPermission = (userRole, requiredPermission) => {
    const role = authConfig.roles[userRole];
    if (!role) return false;
    
    return role.permissions.includes(requiredPermission);
};

const hasMinimumRole = (userRole, minimumRole) => {
    const userRoleLevel = authConfig.roles[userRole]?.level || 0;
    const minimumRoleLevel = authConfig.roles[minimumRole]?.level || 999;
    
    return userRoleLevel >= minimumRoleLevel;
};

// Environment validation
const validateConfig = () => {
    const warnings = [];
    const errors = [];
    
    // Check JWT secret
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === authConfig.jwt.secret) {
        if (process.env.NODE_ENV === 'production') {
            errors.push('JWT_SECRET must be set to a secure value in production');
        } else {
            warnings.push('JWT_SECRET is using default value - change this for production');
        }
    }
    
    // Check session secret
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === authConfig.session.secret) {
        if (process.env.NODE_ENV === 'production') {
            errors.push('SESSION_SECRET must be set to a secure value in production');
        } else {
            warnings.push('SESSION_SECRET is using default value - change this for production');
        }
    }
    
    // Check if HTTPS is enabled in production
    if (process.env.NODE_ENV === 'production' && !authConfig.session.cookie.secure) {
        warnings.push('Consider enabling secure cookies in production (HTTPS)');
    }
    
    // Check email configuration
    if (authConfig.emailVerification.required && (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)) {
        errors.push('Email verification is required but EMAIL_USER or EMAIL_PASS not configured');
    }
    
    return { warnings, errors };
};

// Initialize configuration
const initializeConfig = () => {
    const validation = validateConfig();
    
    if (validation.errors.length > 0) {
        console.error('❌ Authentication configuration errors:');
        validation.errors.forEach(error => console.error(`   - ${error}`));
        process.exit(1);
    }
    
    if (validation.warnings.length > 0) {
        console.warn('⚠️  Authentication configuration warnings:');
        validation.warnings.forEach(warning => console.warn(`   - ${warning}`));
    }
    
    console.log('✅ Authentication configuration loaded successfully');
};

module.exports = {
    ...authConfig,
    validatePassword,
    validateHwid,
    hasPermission,
    hasMinimumRole,
    validateConfig,
    initializeConfig
};