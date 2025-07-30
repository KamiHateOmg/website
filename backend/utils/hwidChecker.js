const crypto = require('crypto');
const logger = require('./logger');

class HWIDChecker {
    constructor() {
        // HWID validation patterns
        this.patterns = {
            // Standard format: XXXX-XXXX-XXXX-XXXX (alphanumeric)
            standard: /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/,
            
            // Extended format: longer alphanumeric string
            extended: /^[A-Za-z0-9-]{10,255}$/,
            
            // Windows GUID format
            guid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
            
            // MAC address format
            mac: /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
            
            // Custom hash format (32-64 character hex)
            hash: /^[a-fA-F0-9]{32,64}$/
        };

        // Suspicious patterns to flag
        this.suspiciousPatterns = [
            /^(0{4}-){3}0{4}$/, // All zeros
            /^(1{4}-){3}1{4}$/, // All ones
            /^(FFFF-){3}FFFF$/i, // All F's
            /^(AAAA-){3}AAAA$/i, // All A's
            /^(TEST-){3}TEST$/i, // TEST pattern
            /^(FAKE-){3}FAKE$/i, // FAKE pattern
            /^(NULL-){3}NULL$/i, // NULL pattern
        ];

        // Blacklisted HWIDs (virtual machines, common spoofs, etc.)
        this.blacklistedHWIDs = new Set([
            '0000-0000-0000-0000',
            '1111-1111-1111-1111',
            'FFFF-FFFF-FFFF-FFFF',
            'AAAA-AAAA-AAAA-AAAA',
            'TEST-TEST-TEST-TEST',
            'FAKE-FAKE-FAKE-FAKE',
            'NULL-NULL-NULL-NULL',
            'VMWARE-VMWARE-VMWARE',
            'VBOX-VBOX-VBOX-VBOX',
            'HYPER-HYPER-HYPER-HYPER'
        ]);

        // Rate limiting for HWID changes
        this.hwidChangeAttempts = new Map();
        this.maxHwidChangesPerHour = 3;
        this.hwidChangeWindowMs = 60 * 60 * 1000; // 1 hour
    }

    // Validate HWID format
    validateFormat(hwid) {
        if (!hwid || typeof hwid !== 'string') {
            return { valid: false, reason: 'HWID is required and must be a string' };
        }

        // Check against all patterns
        for (const [patternName, pattern] of Object.entries(this.patterns)) {
            if (pattern.test(hwid)) {
                return { valid: true, format: patternName };
            }
        }

        return { valid: false, reason: 'HWID format is invalid' };
    }

    // Check if HWID is suspicious
    isSuspicious(hwid) {
        if (!hwid) return true;

        const upperHwid = hwid.toUpperCase();

        // Check blacklist
        if (this.blacklistedHWIDs.has(upperHwid)) {
            return { suspicious: true, reason: 'HWID is blacklisted' };
        }

        // Check suspicious patterns
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(upperHwid)) {
                return { suspicious: true, reason: 'HWID matches suspicious pattern' };
            }
        }

        // Check for too many repeated characters
        const repeatedChar = this.hasRepeatedCharacters(hwid);
        if (repeatedChar.repeated) {
            return { suspicious: true, reason: `Too many repeated characters: ${repeatedChar.char}` };
        }

        // Check entropy (randomness)
        const entropy = this.calculateEntropy(hwid);
        if (entropy < 2.5) { // Low entropy threshold
            return { suspicious: true, reason: 'HWID has low entropy (not random enough)' };
        }

        return { suspicious: false };
    }

    // Calculate entropy of HWID
    calculateEntropy(hwid) {
        if (!hwid) return 0;

        const cleanHwid = hwid.replace(/[-:]/g, ''); // Remove separators
        const frequencies = {};
        
        // Count character frequencies
        for (const char of cleanHwid) {
            frequencies[char] = (frequencies[char] || 0) + 1;
        }

        // Calculate Shannon entropy
        const length = cleanHwid.length;
        let entropy = 0;

        for (const count of Object.values(frequencies)) {
            const probability = count / length;
            entropy -= probability * Math.log2(probability);
        }

        return entropy;
    }

    // Check for repeated characters
    hasRepeatedCharacters(hwid, threshold = 0.7) {
        if (!hwid) return { repeated: false };

        const cleanHwid = hwid.replace(/[-:]/g, '');
        const charCounts = {};
        let maxCount = 0;
        let maxChar = '';

        for (const char of cleanHwid) {
            charCounts[char] = (charCounts[char] || 0) + 1;
            if (charCounts[char] > maxCount) {
                maxCount = charCounts[char];
                maxChar = char;
            }
        }

        const repetitionRatio = maxCount / cleanHwid.length;
        
        return {
            repeated: repetitionRatio > threshold,
            char: maxChar,
            count: maxCount,
            ratio: repetitionRatio
        };
    }

    // Normalize HWID to standard format
    normalizeHWID(hwid) {
        if (!hwid) return null;

        // Remove all non-alphanumeric characters
        const cleaned = hwid.replace(/[^A-Za-z0-9]/g, '');
        
        // Convert to uppercase
        const upper = cleaned.toUpperCase();
        
        // If it's the right length for standard format, add dashes
        if (upper.length === 16) {
            return `${upper.slice(0, 4)}-${upper.slice(4, 8)}-${upper.slice(8, 12)}-${upper.slice(12, 16)}`;
        }
        
        // Return as-is for other formats
        return upper;
    }

    // Generate a hash of HWID for storage (privacy)
    hashHWID(hwid) {
        if (!hwid) return null;
        
        const salt = process.env.HWID_SALT || 'cs2loader_hwid_salt_2025';
        return crypto.createHash('sha256').update(hwid + salt).digest('hex');
    }

    // Verify HWID against stored hash
    verifyHWIDHash(hwid, storedHash) {
        if (!hwid || !storedHash) return false;
        
        const computedHash = this.hashHWID(hwid);
        return computedHash === storedHash;
    }

    // Check HWID change rate limiting
    canChangeHWID(userId, currentTime = Date.now()) {
        const userAttempts = this.hwidChangeAttempts.get(userId) || [];
        
        // Clean old attempts
        const recentAttempts = userAttempts.filter(
            timestamp => currentTime - timestamp < this.hwidChangeWindowMs
        );
        
        this.hwidChangeAttempts.set(userId, recentAttempts);
        
        return {
            allowed: recentAttempts.length < this.maxHwidChangesPerHour,
            attemptsRemaining: Math.max(0, this.maxHwidChangesPerHour - recentAttempts.length),
            resetTime: recentAttempts.length > 0 ? 
                new Date(recentAttempts[0] + this.hwidChangeWindowMs) : null
        };
    }

    // Record HWID change attempt
    recordHWIDChange(userId, currentTime = Date.now()) {
        const userAttempts = this.hwidChangeAttempts.get(userId) || [];
        userAttempts.push(currentTime);
        this.hwidChangeAttempts.set(userId, userAttempts);
    }

    // Comprehensive HWID validation
    async validateHWID(hwid, options = {}) {
        const validation = {
            valid: false,
            normalized: null,
            issues: [],
            warnings: [],
            metadata: {}
        };

        try {
            // Format validation
            const formatCheck = this.validateFormat(hwid);
            if (!formatCheck.valid) {
                validation.issues.push(formatCheck.reason);
                return validation;
            }

            validation.metadata.format = formatCheck.format;

            // Normalize HWID
            const normalizedHWID = this.normalizeHWID(hwid);
            validation.normalized = normalizedHWID;

            // Suspicious pattern check
            const suspiciousCheck = this.isSuspicious(normalizedHWID);
            if (suspiciousCheck.suspicious) {
                if (options.strictMode) {
                    validation.issues.push(suspiciousCheck.reason);
                    return validation;
                } else {
                    validation.warnings.push(suspiciousCheck.reason);
                }
            }

            // Calculate metadata
            validation.metadata.entropy = this.calculateEntropy(normalizedHWID);
            validation.metadata.repeatedChars = this.hasRepeatedCharacters(normalizedHWID);
            validation.metadata.length = normalizedHWID ? normalizedHWID.length : 0;

            // Additional checks if database access is provided
            if (options.db && options.userId) {
                const dbChecks = await this.performDatabaseChecks(
                    options.db, 
                    normalizedHWID, 
                    options.userId
                );
                validation.metadata.dbChecks = dbChecks;
                
                if (dbChecks.issues.length > 0) {
                    validation.issues.push(...dbChecks.issues);
                }
                if (dbChecks.warnings.length > 0) {
                    validation.warnings.push(...dbChecks.warnings);
                }
            }

            // Rate limiting check
            if (options.userId && options.checkRateLimit) {
                const rateLimitCheck = this.canChangeHWID(options.userId);
                if (!rateLimitCheck.allowed) {
                    validation.issues.push(
                        `HWID change rate limit exceeded. Try again after ${rateLimitCheck.resetTime?.toLocaleString()}`
                    );
                    return validation;
                }
                validation.metadata.rateLimit = rateLimitCheck;
            }

            validation.valid = validation.issues.length === 0;
            return validation;

        } catch (error) {
            logger.error('HWID validation error:', {
                error: error.message,
                hwid: hwid?.substring(0, 8) + '...',
                options
            });
            
            validation.issues.push('HWID validation failed due to internal error');
            return validation;
        }
    }

    // Database-specific checks
    async performDatabaseChecks(db, hwid, userId) {
        const checks = {
            issues: [],
            warnings: [],
            metadata: {}
        };

        try {
            // Check if HWID is already in use by another user
            const existingUser = await db.query(
                'SELECT id, email FROM users WHERE hwid = $1 AND id != $2',
                [hwid, userId]
            );

            if (existingUser.rows.length > 0) {
                checks.issues.push('HWID is already associated with another account');
                checks.metadata.conflictingUser = existingUser.rows[0].email;
            }

            // Check if user has active subscriptions on different HWID
            const activeSubscriptions = await db.query(
                `SELECT hwid, COUNT(*) as count 
                 FROM subscriptions 
                 WHERE user_id = $1 AND is_active = true AND expires_at > CURRENT_TIMESTAMP
                 GROUP BY hwid`,
                [userId]
            );

            if (activeSubscriptions.rows.length > 1) {
                checks.warnings.push('User has active subscriptions on multiple HWIDs');
            }

            // Check subscription history for this HWID
            const hwidHistory = await db.query(
                `SELECT COUNT(DISTINCT user_id) as user_count,
                        COUNT(*) as subscription_count,
                        MAX(created_at) as last_used
                 FROM subscriptions 
                 WHERE hwid = $1`,
                [hwid]
            );

            if (hwidHistory.rows.length > 0) {
                const history = hwidHistory.rows[0];
                checks.metadata.hwidHistory = {
                    userCount: parseInt(history.user_count),
                    subscriptionCount: parseInt(history.subscription_count),
                    lastUsed: history.last_used
                };

                // Flag if HWID has been used by many different users
                if (history.user_count > 5) {
                    checks.warnings.push(`HWID has been used by ${history.user_count} different users`);
                }
            }

            // Check for recent HWID changes by this user
            const recentChanges = await db.query(
                `SELECT COUNT(*) as changes
                 FROM audit_logs
                 WHERE user_id = $1 
                 AND action LIKE '%HWID%'
                 AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
                [userId]
            );

            if (recentChanges.rows.length > 0 && parseInt(recentChanges.rows[0].changes) > 3) {
                checks.warnings.push('Frequent HWID changes detected in the last 24 hours');
            }

        } catch (error) {
            logger.error('Database HWID checks failed:', error);
            checks.warnings.push('Could not perform complete HWID verification');
        }

        return checks;
    }

    // Generate a secure HWID for testing purposes
    generateTestHWID(format = 'standard') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        
        switch (format) {
            case 'standard':
                const segments = [];
                for (let i = 0; i < 4; i++) {
                    let segment = '';
                    for (let j = 0; j < 4; j++) {
                        segment += chars[Math.floor(Math.random() * chars.length)];
                    }
                    segments.push(segment);
                }
                return segments.join('-');
                
            case 'guid':
                return crypto.randomUUID();
                
            case 'hash':
                return crypto.randomBytes(32).toString('hex');
                
            default:
                return this.generateTestHWID('standard');
        }
    }

    // HWID similarity check (for detecting similar/related devices)
    calculateHWIDSimilarity(hwid1, hwid2) {
        if (!hwid1 || !hwid2) return 0;

        const clean1 = hwid1.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const clean2 = hwid2.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

        if (clean1 === clean2) return 1;

        // Calculate Levenshtein distance
        const levenshteinDistance = this.calculateLevenshteinDistance(clean1, clean2);
        const maxLength = Math.max(clean1.length, clean2.length);
        
        // Convert to similarity score (0-1)
        return 1 - (levenshteinDistance / maxLength);
    }

    // Levenshtein distance calculation
    calculateLevenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    // Check for HWID spoofing patterns
    detectSpoofingPatterns(hwid, userAgent, ipAddress) {
        const patterns = {
            spoofingLikely: false,
            indicators: [],
            riskScore: 0
        };

        if (!hwid) return patterns;

        // Check for VM indicators in HWID
        const vmPatterns = [
            /VMWARE/i, /VBOX/i, /VIRTUALBOX/i, /QEMU/i, 
            /HYPER-V/i, /XEN/i, /PARALLELS/i
        ];

        for (const pattern of vmPatterns) {
            if (pattern.test(hwid)) {
                patterns.indicators.push('VM-related HWID detected');
                patterns.riskScore += 3;
            }
        }

        // Check for debugger/analysis tool patterns
        const debuggerPatterns = [
            /DEBUG/i, /ANALYST/i, /SANDBOX/i, /MALWARE/i
        ];

        for (const pattern of debuggerPatterns) {
            if (pattern.test(hwid)) {
                patterns.indicators.push('Analysis tool pattern detected');
                patterns.riskScore += 4;
            }
        }

        // Check entropy again for spoofing
        const entropy = this.calculateEntropy(hwid);
        if (entropy > 3.8) { // Very high entropy might indicate random generation
            patterns.indicators.push('Unusually high entropy (possibly generated)');
            patterns.riskScore += 2;
        }

        // Cross-reference with user agent for inconsistencies
        if (userAgent) {
            const isWindows = /Windows/i.test(userAgent);
            const isMac = /Mac OS/i.test(userAgent);
            const isLinux = /Linux/i.test(userAgent);

            // Basic OS consistency check (this would need more sophisticated logic)
            if (isWindows && hwid.length < 16) {
                patterns.indicators.push('HWID format inconsistent with reported OS');
                patterns.riskScore += 2;
            }
        }

        patterns.spoofingLikely = patterns.riskScore >= 5;
        return patterns;
    }

    // Middleware for HWID validation
    createValidationMiddleware(options = {}) {
        return async (req, res, next) => {
            const hwid = req.body.hwid || req.params.hwid || req.query.hwid;

            if (!hwid && options.required !== false) {
                return res.status(400).json({
                    error: 'HWID is required',
                    code: 'HWID_REQUIRED'
                });
            }

            if (hwid) {
                try {
                    const validation = await this.validateHWID(hwid, {
                        strictMode: options.strictMode || false,
                        db: req.app.locals.db,
                        userId: req.user?.id,
                        checkRateLimit: options.checkRateLimit || false
                    });

                    if (!validation.valid) {
                        logger.warn('HWID validation failed', {
                            userId: req.user?.id,
                            hwid: hwid.substring(0, 8) + '...',
                            issues: validation.issues,
                            ip: req.ip
                        });

                        return res.status(400).json({
                            error: 'Invalid HWID',
                            issues: validation.issues,
                            warnings: validation.warnings,
                            code: 'HWID_INVALID'
                        });
                    }

                    // Add validation results to request
                    req.hwidValidation = validation;

                    // Log warnings if any
                    if (validation.warnings.length > 0) {
                        logger.warn('HWID validation warnings', {
                            userId: req.user?.id,
                            hwid: hwid.substring(0, 8) + '...',
                            warnings: validation.warnings,
                            ip: req.ip
                        });
                    }

                    // Check for spoofing patterns
                    if (options.checkSpoofing) {
                        const spoofingCheck = this.detectSpoofingPatterns(
                            hwid, 
                            req.get('User-Agent'), 
                            req.ip
                        );

                        if (spoofingCheck.spoofingLikely) {
                            logger.warn('Potential HWID spoofing detected', {
                                userId: req.user?.id,
                                hwid: hwid.substring(0, 8) + '...',
                                indicators: spoofingCheck.indicators,
                                riskScore: spoofingCheck.riskScore,
                                ip: req.ip,
                                userAgent: req.get('User-Agent')
                            });

                            if (options.blockSpoofing) {
                                return res.status(403).json({
                                    error: 'Suspicious HWID detected',
                                    code: 'HWID_SPOOFING_DETECTED'
                                });
                            }
                        }

                        req.spoofingCheck = spoofingCheck;
                    }

                } catch (error) {
                    logger.error('HWID validation middleware error:', {
                        error: error.message,
                        userId: req.user?.id,
                        hwid: hwid?.substring(0, 8) + '...'
                    });

                    return res.status(500).json({
                        error: 'HWID validation failed',
                        code: 'HWID_VALIDATION_ERROR'
                    });
                }
            }

            next();
        };
    }

    // Cleanup old rate limit data
    cleanupRateLimitData() {
        const currentTime = Date.now();
        let cleanedCount = 0;

        for (const [userId, attempts] of this.hwidChangeAttempts.entries()) {
            const recentAttempts = attempts.filter(
                timestamp => currentTime - timestamp < this.hwidChangeWindowMs
            );

            if (recentAttempts.length === 0) {
                this.hwidChangeAttempts.delete(userId);
                cleanedCount++;
            } else {
                this.hwidChangeAttempts.set(userId, recentAttempts);
            }
        }

        if (cleanedCount > 0) {
            logger.debug(`Cleaned up HWID rate limit data for ${cleanedCount} users`);
        }
    }

    // Get HWID statistics
    getStatistics() {
        return {
            rateLimitEntries: this.hwidChangeAttempts.size,
            blacklistedHWIDs: this.blacklistedHWIDs.size,
            supportedFormats: Object.keys(this.patterns),
            suspiciousPatterns: this.suspiciousPatterns.length
        };
    }

    // Add HWID to blacklist
    addToBlacklist(hwid, reason = 'Manual addition') {
        if (!hwid) return false;

        const normalizedHWID = this.normalizeHWID(hwid);
        this.blacklistedHWIDs.add(normalizedHWID.toUpperCase());

        logger.info('HWID added to blacklist', {
            hwid: normalizedHWID.substring(0, 8) + '...',
            reason
        });

        return true;
    }

    // Remove HWID from blacklist
    removeFromBlacklist(hwid) {
        if (!hwid) return false;

        const normalizedHWID = this.normalizeHWID(hwid);
        const removed = this.blacklistedHWIDs.delete(normalizedHWID.toUpperCase());

        if (removed) {
            logger.info('HWID removed from blacklist', {
                hwid: normalizedHWID.substring(0, 8) + '...'
            });
        }

        return removed;
    }

    // Export blacklist for persistence
    exportBlacklist() {
        return Array.from(this.blacklistedHWIDs);
    }

    // Import blacklist from storage
    importBlacklist(hwidList) {
        if (!Array.isArray(hwidList)) return false;

        let importedCount = 0;
        for (const hwid of hwidList) {
            if (typeof hwid === 'string' && hwid.length > 0) {
                this.blacklistedHWIDs.add(hwid.toUpperCase());
                importedCount++;
            }
        }

        logger.info(`Imported ${importedCount} HWIDs to blacklist`);
        return importedCount;
    }

    // Database integration helpers
    async syncWithDatabase(db) {
        try {
            // Load blacklisted HWIDs from database
            const blacklisted = await db.query(
                'SELECT hwid FROM blacklisted_hwids WHERE is_active = true'
            );

            for (const row of blacklisted.rows) {
                this.blacklistedHWIDs.add(row.hwid.toUpperCase());
            }

            logger.info(`Synced ${blacklisted.rows.length} blacklisted HWIDs from database`);

        } catch (error) {
            logger.error('Failed to sync HWID blacklist with database:', error);
        }
    }

    // Save blacklist to database
    async saveBlacklistToDatabase(db) {
        try {
            // Clear existing blacklist
            await db.query('DELETE FROM blacklisted_hwids');

            // Insert current blacklist
            const values = Array.from(this.blacklistedHWIDs).map(hwid => `('${hwid}')`).join(',');
            
            if (values.length > 0) {
                await db.query(`
                    INSERT INTO blacklisted_hwids (hwid, is_active, created_at) 
                    VALUES ${values.replace(/\('([^']+)'\)/g, "('$1', true, CURRENT_TIMESTAMP)")}
                `);
            }

            logger.info(`Saved ${this.blacklistedHWIDs.size} HWIDs to database blacklist`);

        } catch (error) {
            logger.error('Failed to save HWID blacklist to database:', error);
        }
    }
}

// Create singleton instance
const hwidChecker = new HWIDChecker();

// Cleanup interval (run every hour)
setInterval(() => {
    hwidChecker.cleanupRateLimitData();
}, 60 * 60 * 1000);

module.exports = hwidChecker;