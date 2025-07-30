const logger = require('../utils/logger');

class AuditLog {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Log an audit event
     */
    async log(auditData) {
        const { userId = null, action, details = {}, ipAddress = null, userAgent = null } = auditData;

        if (!action) {
            throw new Error('Action is required for audit logging');
        }

        try {
            const result = await this.pool.query(
                `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, created_at`,
                [userId, action, JSON.stringify(details), ipAddress, userAgent]
            );

            return {
                id: result.rows[0].id,
                createdAt: result.rows[0].created_at
            };

        } catch (error) {
            logger.error('Error logging audit event:', error);
            // Don't throw error to prevent breaking the main operation
            return null;
        }
    }

    /**
     * Log user authentication event
     */
    async logAuth(email, ipAddress, success, userAgent = null, details = {}) {
        return await this.log({
            action: success ? 'USER_LOGIN_SUCCESS' : 'USER_LOGIN_FAILED',
            details: {
                email,
                success,
                ...details
            },
            ipAddress,
            userAgent
        });
    }

    /**
     * Log user registration
     */
    async logRegistration(userId, email, ipAddress, userAgent = null) {
        return await this.log({
            userId,
            action: 'USER_REGISTERED',
            details: { email },
            ipAddress,
            userAgent
        });
    }

    /**
     * Log key redemption
     */
    async logKeyRedemption(userId, keyCode, productName, hwid, ipAddress, success = true) {
        return await this.log({
            userId,
            action: success ? 'KEY_REDEMPTION_SUCCESS' : 'KEY_REDEMPTION_FAILED',
            details: {
                keyCode,
                productName,
                hwid,
                success
            },
            ipAddress
        });
    }

    /**
     * Log admin action
     */
    async logAdminAction(adminId, action, targetId = null, details = {}, ipAddress = null) {
        return await this.log({
            userId: adminId,
            action: `ADMIN_${action.toUpperCase()}`,
            details: {
                targetId,
                ...details
            },
            ipAddress
        });
    }

    /**
     * Log security event
     */
    async logSecurityEvent(action, details = {}, ipAddress = null, userId = null) {
        return await this.log({
            userId,
            action: `SECURITY_${action.toUpperCase()}`,
            details,
            ipAddress
        });
    }

    /**
     * Log desktop app authentication check
     */
    async logDesktopAuth(hwid, success, ipAddress, details = {}) {
        return await this.log({
            action: 'DESKTOP_AUTH_CHECK',
            details: {
                hwid,
                success,
                ...details
            },
            ipAddress
        });
    }

    /**
     * Get audit logs with pagination and filters
     */
    async getLogs(page = 1, limit = 50, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let params = [];
            let paramCount = 1;

            // Build WHERE clause from filters
            const conditions = [];

            if (filters.userId) {
                conditions.push(`al.user_id = $${paramCount}`);
                params.push(filters.userId);
                paramCount++;
            }

            if (filters.action) {
                conditions.push(`al.action ILIKE $${paramCount}`);
                params.push(`%${filters.action}%`);
                paramCount++;
            }

            if (filters.ipAddress) {
                conditions.push(`al.ip_address = $${paramCount}`);
                params.push(filters.ipAddress);
                paramCount++;
            }

            if (filters.dateFrom) {
                conditions.push(`al.created_at >= $${paramCount}`);
                params.push(filters.dateFrom);
                paramCount++;
            }

            if (filters.dateTo) {
                conditions.push(`al.created_at <= $${paramCount}`);
                params.push(filters.dateTo);
                paramCount++;
            }

            if (filters.userEmail) {
                conditions.push(`u.email ILIKE $${paramCount}`);
                params.push(`%${filters.userEmail}%`);
                paramCount++;
            }

            if (conditions.length > 0) {
                whereClause = `WHERE ${conditions.join(' AND ')}`;
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total 
                 FROM audit_logs al 
                 LEFT JOIN users u ON al.user_id = u.id 
                 ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get logs
            const logsResult = await this.pool.query(
                `SELECT 
                    al.id, al.user_id, al.action, al.details, al.ip_address, 
                    al.user_agent, al.created_at,
                    u.email as user_email, u.role as user_role
                 FROM audit_logs al
                 LEFT JOIN users u ON al.user_id = u.id
                 ${whereClause}
                 ORDER BY al.created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                [...params, limit, offset]
            );

            return {
                logs: logsResult.rows.map(log => this.formatLog(log)),
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
            logger.error('Error getting audit logs:', error);
            throw error;
        }
    }

    /**
     * Get user's audit logs
     */
    async getUserLogs(userId, page = 1, limit = 50, actions = []) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = 'WHERE al.user_id = $1';
            let params = [userId];
            let paramCount = 2;

            if (actions.length > 0) {
                const actionConditions = actions.map(() => `$${paramCount++}`).join(', ');
                whereClause += ` AND al.action IN (${actionConditions})`;
                params.push(...actions);
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get logs
            const logsResult = await this.pool.query(
                `SELECT al.id, al.action, al.details, al.ip_address, al.user_agent, al.created_at
                 FROM audit_logs al
                 ${whereClause}
                 ORDER BY al.created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                [...params, limit, offset]
            );

            return {
                logs: logsResult.rows.map(log => this.formatUserLog(log)),
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
            logger.error('Error getting user audit logs:', error);
            throw error;
        }
    }

    /**
     * Get login attempts with filters
     */
    async getLoginAttempts(page = 1, limit = 50, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let params = [];
            let paramCount = 1;

            // Build WHERE clause from filters
            const conditions = [];

            if (filters.email) {
                conditions.push(`email ILIKE $${paramCount}`);
                params.push(`%${filters.email}%`);
                paramCount++;
            }

            if (filters.ipAddress) {
                conditions.push(`ip_address = $${paramCount}`);
                params.push(filters.ipAddress);
                paramCount++;
            }

            if (filters.success !== undefined) {
                conditions.push(`success = $${paramCount}`);
                params.push(filters.success);
                paramCount++;
            }

            if (filters.dateFrom) {
                conditions.push(`created_at >= $${paramCount}`);
                params.push(filters.dateFrom);
                paramCount++;
            }

            if (filters.dateTo) {
                conditions.push(`created_at <= $${paramCount}`);
                params.push(filters.dateTo);
                paramCount++;
            }

            if (conditions.length > 0) {
                whereClause = `WHERE ${conditions.join(' AND ')}`;
            }

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total FROM login_attempts ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Get login attempts
            const attemptsResult = await this.pool.query(
                `SELECT id, email, ip_address, success, user_agent, created_at
                 FROM login_attempts ${whereClause}
                 ORDER BY created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                [...params, limit, offset]
            );

            return {
                attempts: attemptsResult.rows,
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
            logger.error('Error getting login attempts:', error);
            throw error;
        }
    }

    /**
     * Get security statistics
     */
    async getSecurityStats(days = 30) {
        try {
            const result = await this.pool.query(
                `SELECT 
                    COUNT(*) as total_events,
                    COUNT(CASE WHEN action LIKE '%LOGIN%SUCCESS%' THEN 1 END) as successful_logins,
                    COUNT(CASE WHEN action LIKE '%LOGIN%FAILED%' THEN 1 END) as failed_logins,
                    COUNT(CASE WHEN action LIKE '%ADMIN%' THEN 1 END) as admin_actions,
                    COUNT(CASE WHEN action LIKE '%SECURITY%' THEN 1 END) as security_events,
                    COUNT(CASE WHEN action LIKE '%KEY%REDEMPTION%' THEN 1 END) as key_redemptions,
                    COUNT(DISTINCT ip_address) as unique_ips,
                    COUNT(DISTINCT user_id) as unique_users
                 FROM audit_logs 
                 WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'`
            );

            const loginAttemptsResult = await this.pool.query(
                `SELECT 
                    COUNT(*) as total_login_attempts,
                    COUNT(CASE WHEN success = TRUE THEN 1 END) as successful_attempts,
                    COUNT(CASE WHEN success = FALSE THEN 1 END) as failed_attempts,
                    COUNT(DISTINCT ip_address) as unique_login_ips
                 FROM login_attempts 
                 WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'`
            );

            const auditStats = result.rows[0];
            const loginStats = loginAttemptsResult.rows[0];

            return {
                auditLogs: {
                    totalEvents: parseInt(auditStats.total_events),
                    successfulLogins: parseInt(auditStats.successful_logins),
                    failedLogins: parseInt(auditStats.failed_logins),
                    adminActions: parseInt(auditStats.admin_actions),
                    securityEvents: parseInt(auditStats.security_events),
                    keyRedemptions: parseInt(auditStats.key_redemptions),
                    uniqueIps: parseInt(auditStats.unique_ips),
                    uniqueUsers: parseInt(auditStats.unique_users)
                },
                loginAttempts: {
                    totalAttempts: parseInt(loginStats.total_login_attempts),
                    successfulAttempts: parseInt(loginStats.successful_attempts),
                    failedAttempts: parseInt(loginStats.failed_attempts),
                    uniqueIps: parseInt(loginStats.unique_login_ips),
                    successRate: loginStats.total_login_attempts > 0 
                        ? (parseInt(loginStats.successful_attempts) / parseInt(loginStats.total_login_attempts) * 100).toFixed(2)
                        : 0
                },
                period: `${days} days`
            };

        } catch (error) {
            logger.error('Error getting security statistics:', error);
            throw error;
        }
    }

    /**
     * Get most active IPs
     */
    async getMostActiveIPs(limit = 10, days = 30) {
        try {
            const result = await this.pool.query(
                `SELECT 
                    ip_address,
                    COUNT(*) as event_count,
                    COUNT(DISTINCT user_id) as unique_users,
                    MAX(created_at) as last_activity,
                    COUNT(CASE WHEN action LIKE '%FAILED%' THEN 1 END) as failed_events
                 FROM audit_logs 
                 WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
                 AND ip_address IS NOT NULL
                 GROUP BY ip_address
                 ORDER BY event_count DESC
                 LIMIT $1`,
                [limit]
            );

            return result.rows.map(row => ({
                ipAddress: row.ip_address,
                eventCount: parseInt(row.event_count),
                uniqueUsers: parseInt(row.unique_users),
                lastActivity: row.last_activity,
                failedEvents: parseInt(row.failed_events),
                suspiciousActivity: parseInt(row.failed_events) > parseInt(row.event_count) * 0.3 // More than 30% failed
            }));

        } catch (error) {
            logger.error('Error getting most active IPs:', error);
            throw error;
        }
    }

    /**
     * Log login attempt to separate table
     */
    async logLoginAttempt(email, ipAddress, success, userAgent = null) {
        try {
            await this.pool.query(
                'INSERT INTO login_attempts (email, ip_address, success, user_agent) VALUES ($1, $2, $3, $4)',
                [email, ipAddress, success, userAgent]
            );
        } catch (error) {
            logger.error('Failed to log login attempt:', error);
        }
    }

    /**
     * Clean old audit logs
     */
    async cleanOldLogs(days = 365) {
        try {
            const auditResult = await this.pool.query(
                'DELETE FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL $1',
                [`${days} days`]
            );

            const loginResult = await this.pool.query(
                'DELETE FROM login_attempts WHERE created_at < CURRENT_TIMESTAMP - INTERVAL $1',
                [`${days} days`]
            );

            logger.info(`Cleaned ${auditResult.rowCount} audit logs and ${loginResult.rowCount} login attempts older than ${days} days`);

            return {
                auditLogsDeleted: auditResult.rowCount,
                loginAttemptsDeleted: loginResult.rowCount
            };

        } catch (error) {
            logger.error('Error cleaning old logs:', error);
            throw error;
        }
    }

    /**
     * Get recent activity for a user
     */
    async getUserRecentActivity(userId, limit = 20) {
        try {
            const result = await this.pool.query(
                `SELECT al.action, al.details, al.ip_address, al.created_at
                 FROM audit_logs al
                 WHERE al.user_id = $1
                 ORDER BY al.created_at DESC
                 LIMIT $2`,
                [userId, limit]
            );

            return result.rows.map(log => this.formatUserLog(log));

        } catch (error) {
            logger.error('Error getting user recent activity:', error);
            throw error;
        }
    }

    /**
     * Get suspicious activities
     */
    async getSuspiciousActivities(hours = 24, limit = 50) {
        try {
            // Get IPs with high failure rates
            const suspiciousIPs = await this.pool.query(
                `SELECT 
                    ip_address,
                    COUNT(*) as total_attempts,
                    COUNT(CASE WHEN action LIKE '%FAILED%' THEN 1 END) as failed_attempts,
                    ROUND(COUNT(CASE WHEN action LIKE '%FAILED%' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as failure_rate
                 FROM audit_logs 
                 WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
                 AND ip_address IS NOT NULL
                 GROUP BY ip_address
                 HAVING COUNT(*) >= 5 AND COUNT(CASE WHEN action LIKE '%FAILED%' THEN 1 END)::numeric / COUNT(*)::numeric > 0.5
                 ORDER BY failure_rate DESC, total_attempts DESC
                 LIMIT $1`,
                [limit]
            );

            // Get multiple failed login attempts from same IP
            const multipleFailures = await this.pool.query(
                `SELECT 
                    la.ip_address,
                    la.email,
                    COUNT(*) as failed_count,
                    MAX(la.created_at) as last_attempt
                 FROM login_attempts la
                 WHERE la.created_at >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
                 AND la.success = FALSE
                 GROUP BY la.ip_address, la.email
                 HAVING COUNT(*) >= 5
                 ORDER BY failed_count DESC
                 LIMIT $1`,
                [limit]
            );

            return {
                suspiciousIPs: suspiciousIPs.rows,
                multipleFailures: multipleFailures.rows,
                timeWindow: `${hours} hours`
            };

        } catch (error) {
            logger.error('Error getting suspicious activities:', error);
            throw error;
        }
    }

    /**
     * Get action frequency statistics
     */
    async getActionStats(days = 7) {
        try {
            const result = await this.pool.query(
                `SELECT 
                    action,
                    COUNT(*) as count,
                    COUNT(DISTINCT user_id) as unique_users,
                    COUNT(DISTINCT ip_address) as unique_ips,
                    MIN(created_at) as first_occurrence,
                    MAX(created_at) as last_occurrence
                 FROM audit_logs 
                 WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
                 GROUP BY action
                 ORDER BY count DESC`
            );

            return result.rows.map(row => ({
                action: row.action,
                count: parseInt(row.count),
                uniqueUsers: parseInt(row.unique_users),
                uniqueIPs: parseInt(row.unique_ips),
                firstOccurrence: row.first_occurrence,
                lastOccurrence: row.last_occurrence
            }));

        } catch (error) {
            logger.error('Error getting action statistics:', error);
            throw error;
        }
    }

    /**
     * Search audit logs
     */
    async search(query, page = 1, limit = 50) {
        try {
            const offset = (page - 1) * limit;
            const searchTerm = `%${query}%`;

            // Get total count
            const countResult = await this.pool.query(
                `SELECT COUNT(*) as total 
                 FROM audit_logs al 
                 LEFT JOIN users u ON al.user_id = u.id
                 WHERE 
                    al.action ILIKE $1 OR 
                    al.details::text ILIKE $1 OR 
                    al.ip_address ILIKE $1 OR
                    u.email ILIKE $1`,
                [searchTerm]
            );
            const total = parseInt(countResult.rows[0].total);

            // Get matching logs
            const logsResult = await this.pool.query(
                `SELECT 
                    al.id, al.user_id, al.action, al.details, al.ip_address, 
                    al.user_agent, al.created_at,
                    u.email as user_email, u.role as user_role
                 FROM audit_logs al
                 LEFT JOIN users u ON al.user_id = u.id
                 WHERE 
                    al.action ILIKE $1 OR 
                    al.details::text ILIKE $1 OR 
                    al.ip_address ILIKE $1 OR
                    u.email ILIKE $1
                 ORDER BY al.created_at DESC
                 LIMIT $2 OFFSET $3`,
                [searchTerm, limit, offset]
            );

            return {
                logs: logsResult.rows.map(log => this.formatLog(log)),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                    hasNextPage: page < Math.ceil(total / limit),
                    hasPrevPage: page > 1
                },
                query
            };

        } catch (error) {
            logger.error('Error searching audit logs:', error);
            throw error;
        }
    }

    /**
     * Format audit log for API response
     */
    formatLog(log) {
        let details = {};
        try {
            details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
        } catch (e) {
            details = log.details || {};
        }

        return {
            id: log.id,
            userId: log.user_id,
            userEmail: log.user_email,
            userRole: log.user_role,
            action: log.action,
            details,
            ipAddress: log.ip_address,
            userAgent: log.user_agent,
            createdAt: log.created_at,
            actionCategory: this.getActionCategory(log.action),
            severity: this.getActionSeverity(log.action)
        };
    }

    /**
     * Format user-specific audit log
     */
    formatUserLog(log) {
        let details = {};
        try {
            details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
        } catch (e) {
            details = log.details || {};
        }

        return {
            id: log.id,
            action: log.action,
            details,
            ipAddress: log.ip_address,
            userAgent: log.user_agent,
            createdAt: log.created_at,
            actionCategory: this.getActionCategory(log.action),
            description: this.getActionDescription(log.action, details)
        };
    }

    /**
     * Get action category for grouping
     */
    getActionCategory(action) {
        if (action.includes('LOGIN') || action.includes('AUTH')) return 'Authentication';
        if (action.includes('ADMIN')) return 'Administration';
        if (action.includes('KEY')) return 'Key Management';
        if (action.includes('SUBSCRIPTION')) return 'Subscription';
        if (action.includes('SECURITY')) return 'Security';
        if (action.includes('USER')) return 'User Management';
        if (action.includes('PRODUCT')) return 'Product Management';
        if (action.includes('DESKTOP')) return 'Desktop App';
        return 'Other';
    }

    /**
     * Get action severity level
     */
    getActionSeverity(action) {
        if (action.includes('FAILED') || action.includes('SECURITY') || action.includes('ADMIN_DELETE')) {
            return 'high';
        }
        if (action.includes('LOGIN') || action.includes('ADMIN') || action.includes('KEY_REDEMPTION')) {
            return 'medium';
        }
        return 'low';
    }

    /**
     * Get human-readable action description
     */
    getActionDescription(action, details = {}) {
        const descriptions = {
            'USER_LOGIN_SUCCESS': 'Successfully logged in',
            'USER_LOGIN_FAILED': 'Failed login attempt',
            'USER_REGISTERED': 'Account registered',
            'USER_LOGOUT': 'Logged out',
            'KEY_REDEMPTION_SUCCESS': `Redeemed key for ${details.productName || 'product'}`,
            'KEY_REDEMPTION_FAILED': 'Failed to redeem key',
            'ADMIN_GENERATE_KEYS': `Generated ${details.quantity || 'multiple'} keys`,
            'ADMIN_DEACTIVATE_KEY': 'Deactivated a key',
            'EMAIL_VERIFIED': 'Email address verified',
            'PASSWORD_RESET_REQUESTED': 'Requested password reset',
            'PASSWORD_RESET_COMPLETED': 'Password reset completed',
            'DESKTOP_AUTH_CHECK': 'Desktop app authentication check',
            'HWID_UPDATED': 'Hardware ID updated',
            'SECURITY_SUSPICIOUS_ACTIVITY': 'Suspicious activity detected'
        };

        return descriptions[action] || action.replace(/_/g, ' ').toLowerCase();
    }

    /**
     * Export audit logs to CSV format
     */
    async exportLogs(filters = {}, limit = 10000) {
        try {
            const logs = await this.getLogs(1, limit, filters);
            
            const csvHeaders = ['Timestamp', 'User Email', 'Action', 'IP Address', 'Details'];
            const csvRows = logs.logs.map(log => [
                log.createdAt,
                log.userEmail || 'N/A',
                log.action,
                log.ipAddress || 'N/A',
                JSON.stringify(log.details)
            ]);

            return {
                headers: csvHeaders,
                rows: csvRows,
                totalRecords: logs.pagination.total
            };

        } catch (error) {
            logger.error('Error exporting audit logs:', error);
            throw error;
        }
    }

    /**
     * Validate audit log data
     */
    validate(auditData) {
        const errors = [];

        if (!auditData.action || typeof auditData.action !== 'string') {
            errors.push('Valid action is required');
        }

        if (auditData.action && auditData.action.length > 100) {
            errors.push('Action must be 100 characters or less');
        }

        if (auditData.userId && typeof auditData.userId !== 'string') {
            errors.push('User ID must be a valid UUID string');
        }

        if (auditData.ipAddress && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(auditData.ipAddress)) {
            errors.push('Invalid IP address format');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = AuditLog;