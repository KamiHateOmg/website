const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const keyRoutes = require('./routes/keys');
const subscriptionRoutes = require('./routes/subscriptions');
const adminRoutes = require('./routes/admin');

// Import middleware
const logger = require('./utils/logger');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        logger.error('Error connecting to database:', err);
        process.exit(1);
    } else {
        logger.info('Successfully connected to PostgreSQL database');
        release();
    }
});

// Make pool available to routes
app.locals.db = pool;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 auth requests per windowMs
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
    },
    skipSuccessfulRequests: true,
});

// Middleware
app.use(compression());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8080',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Apply rate limiting
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/keys', keyRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// Desktop app API endpoints (no rate limiting for these)
app.get('/api/desktop/subscription/:hwid', async (req, res) => {
    try {
        const { hwid } = req.params;
        
        if (!hwid) {
            return res.status(400).json({ error: 'HWID is required' });
        }

        // Check for active subscription
        const result = await pool.query(
            'SELECT * FROM get_active_subscription($1)',
            [hwid]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'No active subscription found',
                hasActiveSubscription: false
            });
        }

        const subscription = result.rows[0];
        
        res.json({
            hasActiveSubscription: true,
            productName: subscription.product_name,
            expiresAt: subscription.expires_at,
            daysRemaining: subscription.days_remaining,
            timeRemaining: {
                days: Math.floor(subscription.days_remaining),
                hours: Math.floor((subscription.days_remaining % 1) * 24),
                minutes: Math.floor(((subscription.days_remaining % 1) * 24 % 1) * 60)
            }
        });

        // Log access attempt
        await pool.query(
            'INSERT INTO audit_logs (action, details, ip_address) VALUES ($1, $2, $3)',
            ['DESKTOP_AUTH_CHECK', JSON.stringify({ hwid, success: true }), req.ip]
        );

    } catch (error) {
        logger.error('Desktop subscription check error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            hasActiveSubscription: false
        });
    }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../frontend')));
    
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../frontend/index.html'));
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Something went wrong!' 
            : err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    pool.end(() => {
        logger.info('Database pool closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    pool.end(() => {
        logger.info('Database pool closed');
        process.exit(0);
    });
});

// Cleanup expired subscriptions every hour
setInterval(async () => {
    try {
        await pool.query('SELECT deactivate_expired_subscriptions()');
        logger.info('Expired subscriptions cleanup completed');
    } catch (error) {
        logger.error('Subscription cleanup error:', error);
    }
}, 60 * 60 * 1000); // 1 hour

app.listen(PORT, () => {
    logger.info(`🚀 CS2 Loader Backend Server running on port ${PORT}`);
    logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🗄️  Database: Connected to PostgreSQL`);
    logger.info(`🌐 CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:8080'}`);
});

module.exports = app;