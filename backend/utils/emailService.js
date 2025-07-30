const nodemailer = require('nodemailer');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');

class EmailService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this.templateCache = new Map();
        this.initialize();
    }

    initialize() {
        try {
            // Check if email configuration is available
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
                logger.warn('Email service not configured - missing EMAIL_USER or EMAIL_PASS');
                return;
            }

            // Create transporter based on service type
            const emailConfig = {
                service: process.env.EMAIL_SERVICE || 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                },
                pool: true, // Use pooled connections
                maxConnections: 5,
                maxMessages: 100,
                rateLimit: 10 // messages per second
            };

            // For custom SMTP servers
            if (process.env.SMTP_HOST) {
                emailConfig.host = process.env.SMTP_HOST;
                emailConfig.port = parseInt(process.env.SMTP_PORT) || 587;
                emailConfig.secure = process.env.SMTP_SECURE === 'true';
                delete emailConfig.service;
            }

            this.transporter = nodemailer.createTransporter(emailConfig);
            
            // Verify configuration
            this.transporter.verify((error, success) => {
                if (error) {
                    logger.error('Email service verification failed:', error);
                    this.isConfigured = false;
                } else {
                    logger.info('Email service configured successfully');
                    this.isConfigured = true;
                }
            });

        } catch (error) {
            logger.error('Email service initialization failed:', error);
            this.isConfigured = false;
        }
    }

    // Load and cache email templates
    loadTemplate(templateName) {
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName);
        }

        try {
            const templatePath = path.join(__dirname, '../templates/email', `${templateName}.html`);
            
            if (fs.existsSync(templatePath)) {
                const template = fs.readFileSync(templatePath, 'utf8');
                this.templateCache.set(templateName, template);
                return template;
            } else {
                // Return default template if specific template not found
                return this.getDefaultTemplate(templateName);
            }
        } catch (error) {
            logger.error(`Failed to load email template ${templateName}:`, error);
            return this.getDefaultTemplate(templateName);
        }
    }

    // Default email templates
    getDefaultTemplate(templateName) {
        const baseStyle = `
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #58A6FF, #1f6feb); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #fff; padding: 30px; border: 1px solid #ddd; border-top: none; }
                .footer { background: #f6f8fa; padding: 20px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666; }
                .button { display: inline-block; background: #58A6FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
                .button:hover { background: #1f6feb; }
                .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 15px 0; }
                .code { background: #f6f8fa; border: 1px solid #d1d5da; padding: 8px 12px; border-radius: 4px; font-family: monospace; display: inline-block; }
            </style>
        `;

        const templates = {
            verification: `
                ${baseStyle}
                <div class="header">
                    <h1>🎯 CS2 Loader</h1>
                    <h2>Email Verification</h2>
                </div>
                <div class="content">
                    <h3>Welcome {{name}}!</h3>
                    <p>Thank you for registering with CS2 Loader. Please verify your email address to complete your account setup.</p>
                    <p style="text-align: center;">
                        <a href="{{verificationUrl}}" class="button">Verify Email Address</a>
                    </p>
                    <p><strong>Important:</strong> This verification link will expire in 24 hours.</p>
                    <p>If you didn't create this account, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>© 2025 CS2 Loader. All rights reserved.</p>
                </div>
            `,
            
            passwordReset: `
                ${baseStyle}
                <div class="header">
                    <h1>🔒 CS2 Loader</h1>
                    <h2>Password Reset</h2>
                </div>
                <div class="content">
                    <h3>Password Reset Request</h3>
                    <p>You have requested to reset your password for your CS2 Loader account.</p>
                    <p style="text-align: center;">
                        <a href="{{resetUrl}}" class="button">Reset Password</a>
                    </p>
                    <div class="warning">
                        <strong>Security Notice:</strong> This link will expire in 1 hour. If you didn't request this password reset, please ignore this email and your password will remain unchanged.
                    </div>
                </div>
                <div class="footer">
                    <p>© 2025 CS2 Loader. All rights reserved.</p>
                </div>
            `,

            subscriptionExpiry: `
                ${baseStyle}
                <div class="header">
                    <h1>⏰ CS2 Loader</h1>
                    <h2>Subscription Expiring Soon</h2>
                </div>
                <div class="content">
                    <h3>Hi {{name}},</h3>
                    <p>Your CS2 Loader subscription for <strong>{{productName}}</strong> will expire in {{daysRemaining}} days.</p>
                    <p><strong>Expiration Date:</strong> {{expiryDate}}</p>
                    <p>To continue enjoying uninterrupted access to CS2 Loader, please renew your subscription.</p>
                    <p style="text-align: center;">
                        <a href="{{renewUrl}}" class="button">Renew Subscription</a>
                    </p>
                    <p>If you have any questions, please contact our support team.</p>
                </div>
                <div class="footer">
                    <p>© 2025 CS2 Loader. All rights reserved.</p>
                </div>
            `,

            keyRedeemed: `
                ${baseStyle}
                <div class="header">
                    <h1>🎉 CS2 Loader</h1>
                    <h2>Key Successfully Redeemed</h2>
                </div>
                <div class="content">
                    <h3>Congratulations {{name}}!</h3>
                    <p>You have successfully redeemed a key for <strong>{{productName}}</strong>.</p>
                    <p><strong>Subscription Details:</strong></p>
                    <ul>
                        <li>Product: {{productName}}</li>
                        <li>Duration: {{duration}} days</li>
                        <li>Expires: {{expiryDate}}</li>
                        <li>HWID: <span class="code">{{hwid}}</span></li>
                    </ul>
                    <p>Your subscription is now active and you can access CS2 Loader on your registered device.</p>
                    <p style="text-align: center;">
                        <a href="{{dashboardUrl}}" class="button">View Dashboard</a>
                    </p>
                </div>
                <div class="footer">
                    <p>© 2025 CS2 Loader. All rights reserved.</p>
                </div>
            `,

            securityAlert: `
                ${baseStyle}
                <div class="header" style="background: linear-gradient(135deg, #ff6b6b, #ee5a52);">
                    <h1>🚨 CS2 Loader</h1>
                    <h2>Security Alert</h2>
                </div>
                <div class="content">
                    <h3>Security Notice</h3>
                    <p>We detected unusual activity on your CS2 Loader account:</p>
                    <div class="warning">
                        <strong>Activity:</strong> {{activity}}<br>
                        <strong>Time:</strong> {{timestamp}}<br>
                        <strong>IP Address:</strong> {{ipAddress}}<br>
                        <strong>Location:</strong> {{location}}
                    </div>
                    <p>If this was you, no action is needed. If this wasn't you, please secure your account immediately:</p>
                    <p style="text-align: center;">
                        <a href="{{securityUrl}}" class="button">Secure My Account</a>
                    </p>
                    <p>Consider changing your password and enabling two-factor authentication.</p>
                </div>
                <div class="footer">
                    <p>© 2025 CS2 Loader. All rights reserved.</p>
                </div>
            `,

            welcome: `
                ${baseStyle}
                <div class="header">
                    <h1>🎯 CS2 Loader</h1>
                    <h2>Welcome to CS2 Loader!</h2>
                </div>
                <div class="content">
                    <h3>Welcome {{name}}!</h3>
                    <p>Your email has been verified and your CS2 Loader account is now fully activated.</p>
                    <p><strong>Getting Started:</strong></p>
                    <ol>
                        <li>Browse our available products</li>
                        <li>Purchase or redeem a key</li>
                        <li>Download the CS2 Loader client</li>
                        <li>Enjoy enhanced CS2 gameplay!</li>
                    </ol>
                    <p style="text-align: center;">
                        <a href="{{dashboardUrl}}" class="button">Go to Dashboard</a>
                        <a href="{{productsUrl}}" class="button">View Products</a>
                    </p>
                    <p>If you have any questions, our support team is here to help.</p>
                </div>
                <div class="footer">
                    <p>© 2025 CS2 Loader. All rights reserved.</p>
                </div>
            `
        };

        return templates[templateName] || templates.welcome;
    }

    // Replace template variables
    processTemplate(template, variables) {
        let processedTemplate = template;
        
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            processedTemplate = processedTemplate.replace(regex, value || '');
        }
        
        return processedTemplate;
    }

    // Send email function
    async sendEmail(options) {
        if (!this.isConfigured) {
            logger.warn('Email service not configured, skipping email send');
            return { success: false, error: 'Email service not configured' };
        }

        try {
            const mailOptions = {
                from: {
                    name: process.env.EMAIL_FROM_NAME || 'CS2 Loader',
                    address: process.env.EMAIL_USER
                },
                to: options.to,
                subject: options.subject,
                html: options.html,
                text: options.text,
                attachments: options.attachments || []
            };

            // Add reply-to if specified
            if (process.env.EMAIL_REPLY_TO) {
                mailOptions.replyTo = process.env.EMAIL_REPLY_TO;
            }

            const info = await this.transporter.sendMail(mailOptions);
            
            logger.info('Email sent successfully', {
                to: options.to,
                subject: options.subject,
                messageId: info.messageId
            });

            return { success: true, messageId: info.messageId };

        } catch (error) {
            logger.error('Failed to send email:', {
                error: error.message,
                to: options.to,
                subject: options.subject
            });

            return { success: false, error: error.message };
        }
    }

    // Send templated email
    async sendTemplatedEmail(templateName, to, variables = {}) {
        try {
            const template = this.loadTemplate(templateName);
            const html = this.processTemplate(template, {
                ...variables,
                frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8080',
                currentYear: new Date().getFullYear()
            });

            // Generate subject based on template
            const subjects = {
                verification: 'Verify Your CS2 Loader Account',
                passwordReset: 'Reset Your CS2 Loader Password',
                subscriptionExpiry: 'Your CS2 Loader Subscription Expires Soon',
                keyRedeemed: 'CS2 Loader Key Successfully Redeemed',
                securityAlert: 'CS2 Loader Security Alert',
                welcome: 'Welcome to CS2 Loader!'
            };

            const subject = variables.subject || subjects[templateName] || 'CS2 Loader Notification';

            return await this.sendEmail({
                to,
                subject,
                html
            });

        } catch (error) {
            logger.error('Failed to send templated email:', {
                error: error.message,
                templateName,
                to
            });

            return { success: false, error: error.message };
        }
    }

    // Specific email methods
    async sendVerificationEmail(to, verificationToken, userName = null) {
        const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/verify-email?token=${verificationToken}`;
        
        return await this.sendTemplatedEmail('verification', to, {
            name: userName || to.split('@')[0],
            verificationUrl
        });
    }

    async sendPasswordResetEmail(to, resetToken, userName = null) {
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/reset-password?token=${resetToken}`;
        
        return await this.sendTemplatedEmail('passwordReset', to, {
            name: userName || to.split('@')[0],
            resetUrl
        });
    }

    async sendSubscriptionExpiryEmail(to, subscriptionDetails) {
        const renewUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/products`;
        
        return await this.sendTemplatedEmail('subscriptionExpiry', to, {
            name: subscriptionDetails.userName || to.split('@')[0],
            productName: subscriptionDetails.productName,
            daysRemaining: subscriptionDetails.daysRemaining,
            expiryDate: new Date(subscriptionDetails.expiryDate).toLocaleDateString(),
            renewUrl
        });
    }

    async sendKeyRedeemedEmail(to, keyDetails) {
        const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/dashboard`;
        
        return await this.sendTemplatedEmail('keyRedeemed', to, {
            name: keyDetails.userName || to.split('@')[0],
            productName: keyDetails.productName,
            duration: keyDetails.duration,
            expiryDate: new Date(keyDetails.expiryDate).toLocaleDateString(),
            hwid: keyDetails.hwid,
            dashboardUrl
        });
    }

    async sendSecurityAlertEmail(to, alertDetails) {
        const securityUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/security`;
        
        return await this.sendTemplatedEmail('securityAlert', to, {
            name: alertDetails.userName || to.split('@')[0],
            activity: alertDetails.activity,
            timestamp: new Date(alertDetails.timestamp).toLocaleString(),
            ipAddress: alertDetails.ipAddress,
            location: alertDetails.location || 'Unknown',
            securityUrl
        });
    }

    async sendWelcomeEmail(to, userName = null) {
        const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/dashboard`;
        const productsUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/products`;
        
        return await this.sendTemplatedEmail('welcome', to, {
            name: userName || to.split('@')[0],
            dashboardUrl,
            productsUrl
        });
    }

    // Bulk email sending with rate limiting
    async sendBulkEmails(emailList, templateName, variablesFunction) {
        const results = [];
        const batchSize = 10; // Send in batches to avoid overwhelming the service
        const delayBetweenBatches = 1000; // 1 second delay between batches

        for (let i = 0; i < emailList.length; i += batchSize) {
            const batch = emailList.slice(i, i + batchSize);
            const batchPromises = batch.map(async (emailData) => {
                try {
                    const variables = variablesFunction ? variablesFunction(emailData) : emailData.variables || {};
                    const result = await this.sendTemplatedEmail(templateName, emailData.email, variables);
                    return { email: emailData.email, ...result };
                } catch (error) {
                    return { email: emailData.email, success: false, error: error.message };
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(r => r.value || { success: false, error: 'Promise rejected' }));

            // Delay between batches
            if (i + batchSize < emailList.length) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.length - successCount;

        logger.info('Bulk email sending completed', {
            total: results.length,
            successful: successCount,
            failed: failureCount,
            templateName
        });

        return {
            total: results.length,
            successful: successCount,
            failed: failureCount,
            results
        };
    }

    // Email queue for high-volume sending (basic implementation)
    async queueEmail(templateName, to, variables = {}, priority = 'normal') {
        // In a production system, you'd use a proper queue like Redis Queue or Bull
        // This is a simple in-memory queue for demonstration
        if (!this.emailQueue) {
            this.emailQueue = [];
            this.processEmailQueue();
        }

        this.emailQueue.push({
            id: Date.now() + Math.random(),
            templateName,
            to,
            variables,
            priority,
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date()
        });

        logger.debug('Email queued', { templateName, to, priority });
    }

    // Process email queue
    async processEmailQueue() {
        if (!this.emailQueue) return;

        setInterval(async () => {
            if (this.emailQueue.length === 0) return;

            // Sort by priority (high -> normal -> low)
            this.emailQueue.sort((a, b) => {
                const priorities = { high: 3, normal: 2, low: 1 };
                return priorities[b.priority] - priorities[a.priority];
            });

            const email = this.emailQueue.shift();
            
            try {
                const result = await this.sendTemplatedEmail(email.templateName, email.to, email.variables);
                
                if (!result.success) {
                    email.attempts++;
                    if (email.attempts < email.maxAttempts) {
                        // Re-queue for retry
                        this.emailQueue.unshift(email);
                        logger.warn('Email failed, re-queued for retry', {
                            id: email.id,
                            attempts: email.attempts,
                            error: result.error
                        });
                    } else {
                        logger.error('Email failed permanently after max attempts', {
                            id: email.id,
                            attempts: email.attempts,
                            to: email.to
                        });
                    }
                }
            } catch (error) {
                logger.error('Email queue processing error:', error);
            }
        }, 2000); // Process every 2 seconds
    }

    // Get email service status
    getStatus() {
        return {
            configured: this.isConfigured,
            service: process.env.EMAIL_SERVICE || 'gmail',
            queueLength: this.emailQueue ? this.emailQueue.length : 0,
            templatesLoaded: this.templateCache.size
        };
    }

    // Test email configuration
    async testConfiguration() {
        if (!this.isConfigured) {
            return { success: false, error: 'Email service not configured' };
        }

        try {
            await this.transporter.verify();
            return { success: true, message: 'Email configuration is valid' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;