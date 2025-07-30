const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const logger = require('../utils/logger');

// In-memory store for rate limiting (consider Redis for production scaling)
const MemoryStore = require('express-rate-limit').MemoryStore;

// Base rate limiter configuration
const createRateLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: {
            error: 'Too many requests from this IP, please try again later.',
            retryAfter: Math.ceil(options.windowMs / 1000 / 60) || 15
        },
        standardHeaders: true,
        legacyHeaders: false,
        store: new MemoryStore(),
        skip: (req) => {
            // Skip rate limiting for health checks and certain admin operations
            return req.path === '/health' || req.path === '/api/health';
        },
        onLimitReached: (req, res, options) => {
            logger.warn('Rate limit exceeded', {
                ip: req.ip,
                path: req.path,
                method: req.method,
                userAgent: req.get('User-Agent'),
                limit: options.max,
                windowMs: options.windowMs
            });
        }
    };

    return rateLimit({ ...defaultOptions, ...options });
};

// General API rate limiter
const apiLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes
    message: {
        error: 'Too many API requests, please try again later.',
        retryAfter: 15
    }
});

// Authentication rate limiter (stricter)
const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 auth attempts per 15 minutes
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: 15
    },
    skipSuccessfulRequests: true, // Don't count successful requests
    skipFailedRequests: false // Count failed requests
});

// Password reset rate limiter
const passwordResetLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset attempts per hour
    message: {
        error: 'Too many password reset attempts, please try again later.',
        retryAfter: 60
    }
});

// Key redemption rate limiter
const keyRedemptionLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 key redemption attempts per 5 minutes
    message: {
        error: 'Too many key redemption attempts, please slow down.',
        retryAfter: 5
    }
});

// Desktop app rate limiter (more lenient)
const desktopLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: {
        error: 'Desktop app rate limit exceeded.',
        retryAfter: 1
    }
});

// Admin operations rate limiter
const adminLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 50, // 50 admin requests per 10 minutes
    message: {
        error: 'Too many admin operations, please slow down.',
        retryAfter: 10
    }
});

// Progressive delay middleware (slows down requests instead of blocking)
const progressiveDelay = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // allow 50 requests per windowMs at full speed
    delayMs: 500, // add 500ms delay per request after delayAfter
    maxDelayMs: 5000, // max delay of 5 seconds
    skipSuccessfulRequests: true,
    onLimitReached: (req, res, options) => {
        logger.info('Progressive delay applied', {
            ip: req.ip,
            path: req.path,
            delay: options.delay
        });
    }
});

// Per-user rate limiter (based on user ID from JWT)
const createUserBasedLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: 15 * 60 * 1000,
        max: 200, // Higher limit for authenticated users
        keyGenerator: (req) => {
            // Use user ID if authenticated, otherwise fall back to IP
            return req.user?.id || req.ip;
        },
        skip: (req) => {
            // Skip for admin users
            return req.user?.role === 'admin';
        }
    };

    return createRateLimiter({ ...defaultOptions, ...options });
};

// User-based API limiter
const userApiLimiter = createUserBasedLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200 // 200 requests per 15 minutes for authenticated users
});

// HWID-based rate limiter for desktop app
const hwidLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute per HWID
    keyGenerator: (req) => {
        return req.params.hwid || req.body.hwid || req.ip;
    },
    message: {
        error: 'HWID rate limit exceeded.',
        retryAfter: 1
    },
    standardHeaders: true,
    legacyHeaders: false,
    onLimitReached: (req, res, options) => {
        logger.warn('HWID rate limit exceeded', {
            hwid: req.params.hwid || req.body.hwid,
            ip: req.ip,
            path: req.path
        });
    }
});

// Dynamic rate limiter based on user role
const dynamicRoleLimiter = (req, res, next) => {
    let limiter;

    switch (req.user?.role) {
        case 'admin':
            // Admins get higher limits
            limiter = createRateLimiter({
                windowMs: 15 * 60 * 1000,
                max: 500,
                keyGenerator: () => req.user.id
            });
            break;
        case 'staff':
            // Staff get moderate limits
            limiter = createRateLimiter({
                windowMs: 15 * 60 * 1000,
                max: 300,
                keyGenerator: () => req.user.id
            });
            break;
        default:
            // Regular users get standard limits
            limiter = userApiLimiter;
    }

    limiter(req, res, next);
};

// Rate limiter for sensitive operations (like account changes)
const sensitiveOperationLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 sensitive operations per hour
    keyGenerator: (req) => {
        return req.user?.id || req.ip;
    },
    message: {
        error: 'Too many sensitive operations, please try again later.',
        retryAfter: 60
    }
});

// Burst protection for rapid requests
const burstProtection = createRateLimiter({
    windowMs: 1000, // 1 second
    max: 5, // 5 requests per second
    message: {
        error: 'Request burst detected, please slow down.',
        retryAfter: 1
    }
});

// Global rate limiter with different tiers
const createTieredLimiter = () => {
    const tiers = {
        bronze: { windowMs: 15 * 60 * 1000, max: 100 },
        silver: { windowMs: 15 * 60 * 1000, max: 200 },
        gold: { windowMs: 15 * 60 * 1000, max: 500 },
        admin: { windowMs: 15 * 60 * 1000, max: 1000 }
    };

    return (req, res, next) => {
        let tier = 'bronze'; // default tier

        // Determine tier based on user role or subscription
        if (req.user) {
            switch (req.user.role) {
                case 'admin':
                    tier = 'admin';
                    break;
                case 'staff':
                    tier = 'gold';
                    break;
                default:
                    tier = 'silver'; // authenticated users get silver
            }
        }

        const limiterConfig = tiers[tier];
        const limiter = createRateLimiter({
            ...limiterConfig,
            keyGenerator: () => req.user?.id || req.ip
        });

        limiter(req, res, next);
    };
};

// Cleanup function for memory stores (call periodically)
const cleanupRateLimiters = () => {
    // This would typically be handled by the rate limiting library
    // but you can implement custom cleanup logic here if needed
    logger.debug('Rate limiter cleanup completed');
};

// Error handler for rate limit errors
const rateLimitErrorHandler = (err, req, res, next) => {
    if (err && err.status === 429) {
        logger.warn('Rate limit error handled', {
            ip: req.ip,
            path: req.path,
            error: err.message
        });
        
        return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: err.retryAfter || 60,
            timestamp: new Date().toISOString()
        });
    }
    
    next(err);
};

module.exports = {
    // Basic limiters
    apiLimiter,
    authLimiter,
    passwordResetLimiter,
    keyRedemptionLimiter,
    desktopLimiter,
    adminLimiter,
    
    // Advanced limiters
    progressiveDelay,
    userApiLimiter,
    hwidLimiter,
    dynamicRoleLimiter,
    sensitiveOperationLimiter,
    burstProtection,
    
    // Factory functions
    createRateLimiter,
    createUserBasedLimiter,
    createTieredLimiter,
    
    // Utilities
    cleanupRateLimiters,
    rateLimitErrorHandler
};