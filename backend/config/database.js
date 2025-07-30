require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');

// Database configuration object
const databaseConfig = {
    // Connection settings
    connection: {
        connectionString: process.env.DATABASE_URL,
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'cs2_loader',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        
        // SSL configuration
        ssl: process.env.NODE_ENV === 'production' ? {
            rejectUnauthorized: false,
            ca: process.env.DB_SSL_CA,
            cert: process.env.DB_SSL_CERT,
            key: process.env.DB_SSL_KEY
        } : false,
        
        // Connection pool settings
        max: parseInt(process.env.DB_POOL_MAX) || 20,
        min: parseInt(process.env.DB_POOL_MIN) || 2,
        idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
        acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000,
        evict: parseInt(process.env.DB_POOL_EVICT) || 1000,
        
        // Connection timeout
        connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000,
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
        
        // Query timeout
        query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 30000,
        
        // Statement timeout
        statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000,
        
        // Application name for monitoring
        application_name: 'cs2_loader_backend'
    },

    // Retry configuration
    retry: {
        attempts: parseInt(process.env.DB_RETRY_ATTEMPTS) || 3,
        delay: parseInt(process.env.DB_RETRY_DELAY) || 1000,
        backoff: 'exponential'
    },

    // Logging configuration
    logging: {
        enabled: process.env.DB_LOGGING === 'true',
        logQueries: process.env.DB_LOG_QUERIES === 'true',
        logSlowQueries: process.env.DB_LOG_SLOW_QUERIES === 'true',
        slowQueryThreshold: parseInt(process.env.DB_SLOW_QUERY_THRESHOLD) || 1000,
        logConnections: process.env.DB_LOG_CONNECTIONS === 'true'
    },

    // Health check configuration
    healthCheck: {
        enabled: true,
        interval: parseInt(process.env.DB_HEALTH_CHECK_INTERVAL) || 30000,
        timeout: parseInt(process.env.DB_HEALTH_CHECK_TIMEOUT) || 5000,
        retries: parseInt(process.env.DB_HEALTH_CHECK_RETRIES) || 3
    },

    // Backup configuration
    backup: {
        enabled: process.env.DB_BACKUP_ENABLED === 'true',
        schedule: process.env.DB_BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
        retention: parseInt(process.env.DB_BACKUP_RETENTION) || 30, // days
        path: process.env.DB_BACKUP_PATH || './backups'
    },

    // Migration configuration
    migrations: {
        directory: './database/migrations',
        tableName: 'migrations',
        autoRun: process.env.DB_AUTO_MIGRATE === 'true'
    }
};

// Create connection pool
let pool = null;

const createPool = () => {
    try {
        const config = databaseConfig.connection.connectionString ? {
            connectionString: databaseConfig.connection.connectionString,
            ssl: databaseConfig.connection.ssl,
            max: databaseConfig.connection.max,
            min: databaseConfig.connection.min,
            idleTimeoutMillis: databaseConfig.connection.idleTimeoutMillis,
            connectionTimeoutMillis: databaseConfig.connection.connectionTimeoutMillis,
            query_timeout: databaseConfig.connection.query_timeout,
            statement_timeout: databaseConfig.connection.statement_timeout,
            application_name: databaseConfig.connection.application_name
        } : {
            host: databaseConfig.connection.host,
            port: databaseConfig.connection.port,
            database: databaseConfig.connection.database,
            user: databaseConfig.connection.user,
            password: databaseConfig.connection.password,
            ssl: databaseConfig.connection.ssl,
            max: databaseConfig.connection.max,
            min: databaseConfig.connection.min,
            idleTimeoutMillis: databaseConfig.connection.idleTimeoutMillis,
            connectionTimeoutMillis: databaseConfig.connection.connectionTimeoutMillis,
            query_timeout: databaseConfig.connection.query_timeout,
            statement_timeout: databaseConfig.connection.statement_timeout,
            application_name: databaseConfig.connection.application_name
        };

        pool = new Pool(config);

        // Pool event handlers
        pool.on('connect', (client) => {
            if (databaseConfig.logging.logConnections) {
                logger.info('Database client connected', {
                    processId: client.processID,
                    database: client.database
                });
            }
        });

        pool.on('acquire', (client) => {
            if (databaseConfig.logging.logConnections) {
                logger.debug('Database client acquired from pool', {
                    processId: client.processID
                });
            }
        });

        pool.on('remove', (client) => {
            if (databaseConfig.logging.logConnections) {
                logger.info('Database client removed from pool', {
                    processId: client.processID
                });
            }
        });

        pool.on('error', (err, client) => {
            logger.error('Database pool error', {
                error: err.message,
                stack: err.stack,
                processId: client?.processID
            });
        });

        return pool;
    } catch (error) {
        logger.error('Failed to create database pool', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

// Query wrapper with logging and retry logic
const query = async (text, params = [], retries = databaseConfig.retry.attempts) => {
    const start = Date.now();
    let client = null;
    
    try {
        if (!pool) {
            throw new Error('Database pool not initialized');
        }

        client = await pool.connect();
        const result = await client.query(text, params);
        const duration = Date.now() - start;

        // Log query if enabled
        if (databaseConfig.logging.logQueries) {
            logger.logQuery(text, params, duration);
        }

        // Log slow queries
        if (databaseConfig.logging.logSlowQueries && duration > databaseConfig.logging.slowQueryThreshold) {
            logger.warn('Slow query detected', {
                query: text.replace(/\s+/g, ' ').trim(),
                params: params,
                duration: `${duration}ms`,
                threshold: `${databaseConfig.logging.slowQueryThreshold}ms`
            });
        }

        return result;
    } catch (error) {
        const duration = Date.now() - start;
        
        logger.error('Database query error', {
            error: error.message,
            query: text.replace(/\s+/g, ' ').trim(),
            params: params,
            duration: `${duration}ms`,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            position: error.position,
            retries: retries
        });

        // Retry logic for connection errors
        if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT')) {
            logger.info(`Retrying query, ${retries} attempts remaining`);
            await new Promise(resolve => setTimeout(resolve, databaseConfig.retry.delay));
            return query(text, params, retries - 1);
        }

        throw error;
    } finally {
        if (client) {
            client.release();
        }
    }
};

// Transaction wrapper
const transaction = async (callback) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Transaction error', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    } finally {
        client.release();
    }
};

// Health check function
const healthCheck = async () => {
    try {
        const start = Date.now();
        const result = await query('SELECT 1 as healthy, current_timestamp as timestamp, current_database() as database');
        const duration = Date.now() - start;
        
        return {
            healthy: true,
            timestamp: result.rows[0].timestamp,
            database: result.rows[0].database,
            responseTime: duration,
            pool: {
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount
            }
        };
    } catch (error) {
        logger.error('Health check failed', {
            error: error.message,
            code: error.code
        });
        
        return {
            healthy: false,
            error: error.message,
            code: error.code,
            timestamp: new Date()
        };
    }
};

// Get pool statistics
const getPoolStats = () => {
    if (!pool) {
        return null;
    }
    
    return {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
        max: databaseConfig.connection.max,
        min: databaseConfig.connection.min
    };
};

// Connection test
const testConnection = async () => {
    try {
        logger.info('Testing database connection...');
        
        const result = await query(`
            SELECT 
                current_database() as database,
                current_user as user,
                version() as version,
                current_timestamp as timestamp
        `);
        
        const info = result.rows[0];
        logger.info('Database connection successful', {
            database: info.database,
            user: info.user,
            version: info.version.split(' ')[0] + ' ' + info.version.split(' ')[1],
            timestamp: info.timestamp
        });
        
        return true;
    } catch (error) {
        logger.error('Database connection test failed', {
            error: error.message,
            code: error.code,
            detail: error.detail
        });
        return false;
    }
};

// Initialize database connection
const initialize = async () => {
    try {
        logger.info('Initializing database connection...');
        
        // Validate configuration
        if (!databaseConfig.connection.connectionString && !databaseConfig.connection.host) {
            throw new Error('Database connection configuration missing');
        }
        
        // Create pool
        createPool();
        
        // Test connection
        const connected = await testConnection();
        if (!connected) {
            throw new Error('Failed to establish database connection');
        }
        
        // Start health check if enabled
        if (databaseConfig.healthCheck.enabled) {
            setInterval(async () => {
                const health = await healthCheck();
                if (!health.healthy) {
                    logger.error('Database health check failed', health);
                }
            }, databaseConfig.healthCheck.interval);
        }
        
        logger.info('Database initialized successfully');
        return pool;
    } catch (error) {
        logger.error('Database initialization failed', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

// Graceful shutdown
const shutdown = async () => {
    if (pool) {
        try {
            logger.info('Shutting down database connection pool...');
            await pool.end();
            logger.info('Database connection pool closed');
        } catch (error) {
            logger.error('Error during database shutdown', {
                error: error.message
            });
        }
    }
};

// Database maintenance functions
const maintenance = {
    // Vacuum analyze tables
    vacuum: async (tables = []) => {
        try {
            logger.info('Starting database vacuum...');
            
            if (tables.length === 0) {
                await query('VACUUM ANALYZE');
                logger.info('Full database vacuum completed');
            } else {
                for (const table of tables) {
                    await query(`VACUUM ANALYZE ${table}`);
                    logger.info(`Vacuum completed for table: ${table}`);
                }
            }
        } catch (error) {
            logger.error('Vacuum operation failed', {
                error: error.message,
                tables: tables
            });
            throw error;
        }
    },

    // Reindex tables
    reindex: async (tables = []) => {
        try {
            logger.info('Starting database reindex...');
            
            if (tables.length === 0) {
                await query('REINDEX DATABASE CURRENT_DATABASE()');
                logger.info('Full database reindex completed');
            } else {
                for (const table of tables) {
                    await query(`REINDEX TABLE ${table}`);
                    logger.info(`Reindex completed for table: ${table}`);
                }
            }
        } catch (error) {
            logger.error('Reindex operation failed', {
                error: error.message,
                tables: tables
            });
            throw error;
        }
    },

    // Get table statistics
    getTableStats: async () => {
        try {
            const result = await query(`
                SELECT 
                    schemaname,
                    tablename,
                    attname,
                    n_distinct,
                    correlation
                FROM pg_stats 
                WHERE schemaname = 'public'
                ORDER BY tablename, attname
            `);
            
            return result.rows;
        } catch (error) {
            logger.error('Failed to get table statistics', {
                error: error.message
            });
            throw error;
        }
    },

    // Get database size information
    getDatabaseSize: async () => {
        try {
            const result = await query(`
                SELECT 
                    pg_size_pretty(pg_database_size(current_database())) as database_size,
                    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as table_count,
                    (SELECT count(*) FROM information_schema.routines WHERE routine_schema = 'public') as function_count
            `);
            
            return result.rows[0];
        } catch (error) {
            logger.error('Failed to get database size', {
                error: error.message
            });
            throw error;
        }
    }
};

// Export configuration and functions
module.exports = {
    config: databaseConfig,
    pool: () => pool,
    query,
    transaction,
    healthCheck,
    getPoolStats,
    testConnection,
    initialize,
    shutdown,
    maintenance
};