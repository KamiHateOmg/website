const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(process.cwd(), 'logs');
        this.logFile = path.join(this.logDir, 'app.log');
        this.errorFile = path.join(this.logDir, 'error.log');
        
        // Create logs directory if it doesn't exist
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.levels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };

        this.currentLevel = process.env.LOG_LEVEL ? 
            this.levels[process.env.LOG_LEVEL.toUpperCase()] : 
            this.levels.INFO;
    }

    formatMessage(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const pid = process.pid;
        
        let logEntry = {
            timestamp,
            level,
            pid,
            message: typeof message === 'string' ? message : JSON.stringify(message)
        };

        // Add metadata if provided
        if (Object.keys(meta).length > 0) {
            logEntry.meta = meta;
        }

        // For console output, format nicely
        const consoleMessage = `[${timestamp}] ${level.padEnd(5)} [${pid}] ${logEntry.message}`;
        
        // For file output, use JSON
        const fileMessage = JSON.stringify(logEntry);

        return { consoleMessage, fileMessage };
    }

    writeToFile(fileName, message) {
        try {
            const logEntry = message + '\n';
            fs.appendFileSync(fileName, logEntry, 'utf8');
        } catch (error) {
            // If we can't write to file, at least output to console
            console.error('Failed to write to log file:', error.message);
        }
    }

    log(level, message, meta = {}) {
        if (this.levels[level] > this.currentLevel) {
            return; // Don't log if level is higher than current level
        }

        const { consoleMessage, fileMessage } = this.formatMessage(level, message, meta);

        // Always write to console in development
        if (process.env.NODE_ENV !== 'production') {
            if (level === 'ERROR') {
                console.error(consoleMessage);
            } else if (level === 'WARN') {
                console.warn(consoleMessage);
            } else {
                console.log(consoleMessage);
            }
        }

        // Write to appropriate log files
        this.writeToFile(this.logFile, fileMessage);
        
        if (level === 'ERROR') {
            this.writeToFile(this.errorFile, fileMessage);
        }
    }

    error(message, meta = {}) {
        // Handle Error objects
        if (message instanceof Error) {
            meta.stack = message.stack;
            meta.name = message.name;
            message = message.message;
        }
        
        this.log('ERROR', message, meta);
    }

    warn(message, meta = {}) {
        this.log('WARN', message, meta);
    }

    info(message, meta = {}) {
        this.log('INFO', message, meta);
    }

    debug(message, meta = {}) {
        this.log('DEBUG', message, meta);
    }

    // HTTP request logging middleware
    httpLogger() {
        return (req, res, next) => {
            const start = Date.now();
            
            // Override res.end to capture response details
            const originalEnd = res.end;
            res.end = function(...args) {
                const duration = Date.now() - start;
                
                // Log the request
                logger.info('HTTP Request', {
                    method: req.method,
                    url: req.url,
                    userAgent: req.get('User-Agent'),
                    ip: req.ip || req.connection.remoteAddress,
                    statusCode: res.statusCode,
                    duration: `${duration}ms`,
                    contentLength: res.get('Content-Length') || 0
                });

                // Call the original end method
                originalEnd.apply(this, args);
            };

            next();
        };
    }

    // Database query logging
    logQuery(query, params = [], duration = null) {
        if (this.currentLevel >= this.levels.DEBUG) {
            const meta = {
                query: query.replace(/\s+/g, ' ').trim(),
                params: params,
                ...(duration && { duration: `${duration}ms` })
            };
            
            this.debug('Database Query', meta);
        }
    }

    // Security event logging
    logSecurityEvent(event, details = {}) {
        this.warn(`Security Event: ${event}`, {
            ...details,
            timestamp: new Date().toISOString(),
            severity: 'security'
        });
    }

    // Performance logging
    logPerformance(operation, duration, meta = {}) {
        const level = duration > 1000 ? 'WARN' : 'INFO';
        this.log(level, `Performance: ${operation}`, {
            duration: `${duration}ms`,
            ...meta
        });
    }

    // Cleanup old log files (call this periodically)
    cleanupLogs(daysToKeep = 30) {
        try {
            const files = fs.readdirSync(this.logDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime < cutoffDate) {
                    fs.unlinkSync(filePath);
                    this.info(`Cleaned up old log file: ${file}`);
                }
            });
        } catch (error) {
            this.error('Failed to cleanup log files', { error: error.message });
        }
    }

    // Get log file contents (for admin panel)
    getLogContents(logType = 'app', lines = 100) {
        try {
            const fileName = logType === 'error' ? this.errorFile : this.logFile;
            
            if (!fs.existsSync(fileName)) {
                return [];
            }

            const content = fs.readFileSync(fileName, 'utf8');
            const logLines = content.trim().split('\n').filter(line => line.length > 0);
            
            // Return the last N lines
            const recentLines = logLines.slice(-lines);
            
            // Parse JSON log entries
            return recentLines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (error) {
                    // If line is not valid JSON, return as plain text
                    return {
                        timestamp: new Date().toISOString(),
                        level: 'INFO',
                        message: line,
                        raw: true
                    };
                }
            }).reverse(); // Most recent first

        } catch (error) {
            this.error('Failed to read log contents', { error: error.message });
            return [];
        }
    }

    // Express error handler middleware
    errorHandler() {
        return (err, req, res, next) => {
            // Log the error
            this.error('Express Error Handler', {
                error: err.message,
                stack: err.stack,
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent'),
                ip: req.ip || req.connection.remoteAddress,
                body: req.method !== 'GET' ? req.body : undefined
            });

            // Don't expose stack traces in production
            if (process.env.NODE_ENV === 'production') {
                res.status(500).json({
                    error: 'Internal server error',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(500).json({
                    error: err.message,
                    stack: err.stack,
                    timestamp: new Date().toISOString()
                });
            }
        };
    }
}

// Create a singleton instance
const logger = new Logger();

// Start log cleanup interval (run daily)
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        logger.cleanupLogs(30); // Keep logs for 30 days
    }, 24 * 60 * 60 * 1000); // Every 24 hours
}

module.exports = logger;