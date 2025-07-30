// CS2 Loader - Authentication Utilities
// Handles user authentication, token management, and session control

/**
 * Authentication Manager Class
 * Manages user authentication state, tokens, and session persistence
 */
class AuthManager {
    constructor() {
        this.user = null;
        this.token = null;
        this.refreshTimer = null;
        this.sessionCheckInterval = null;
        
        this.init();
    }

    /**
     * Initialize authentication manager
     */
    init() {
        this.loadStoredAuth();
        this.startSessionCheck();
        this.bindEvents();
    }

    /**
     * Load stored authentication data
     */
    loadStoredAuth() {
        try {
            const storedToken = localStorage.getItem('token');
            const storedUser = localStorage.getItem('user');
            
            if (storedToken && storedUser) {
                this.token = storedToken;
                this.user = JSON.parse(storedUser);
                
                // Validate token on load
                this.validateToken();
            }
        } catch (error) {
            console.error('Error loading stored auth:', error);
            this.clearAuth();
        }
    }

    /**
     * Bind global events
     */
    bindEvents() {
        // Handle storage changes (multi-tab support)
        window.addEventListener('storage', (e) => {
            if (e.key === 'token' || e.key === 'user') {
                if (e.newValue === null) {
                    // User logged out in another tab
                    this.handleLogout(false);
                } else if (e.key === 'token') {
                    // User logged in in another tab
                    this.loadStoredAuth();
                    this.updateUI();
                }
            }
        });

        // Handle page visibility change
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isAuthenticated()) {
                this.validateToken();
            }
        });
    }

    /**
     * Login user with credentials
     */
    async login(credentials) {
        try {
            const response = await authAPI.login(credentials);
            
            if (response.data && response.data.token && response.data.user) {
                this.setAuth(response.data.token, response.data.user);
                this.updateUI();
                
                // Log successful login
                this.logAuthEvent('login', 'success');
                
                return {
                    success: true,
                    user: response.data.user,
                    message: 'Login successful'
                };
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            this.logAuthEvent('login', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Register new user
     */
    async register(userData) {
        try {
            const response = await authAPI.register(userData);
            
            if (response.data && response.data.user) {
                // For registration, user might need email verification
                this.logAuthEvent('register', 'success');
                
                return {
                    success: true,
                    user: response.data.user,
                    requiresVerification: response.data.requiresEmailVerification,
                    message: 'Registration successful'
                };
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            this.logAuthEvent('register', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Logout user
     */
    async logout(callAPI = true) {
        try {
            if (callAPI && this.isAuthenticated()) {
                await authAPI.logout();
            }
        } catch (error) {
            console.warn('Logout API call failed:', error);
        } finally {
            this.handleLogout(true);
        }
    }

    /**
     * Handle logout process
     */
    handleLogout(updateStorage = true) {
        this.logAuthEvent('logout', 'success');
        
        if (updateStorage) {
            this.clearAuth();
        }
        
        this.user = null;
        this.token = null;
        
        this.stopSessionCheck();
        this.updateUI();
        
        // Dispatch logout event
        window.dispatchEvent(new CustomEvent('userLogout'));
    }

    /**
     * Set authentication data
     */
    setAuth(token, user) {
        this.token = token;
        this.user = user;
        
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        
        // Start token refresh timer
        this.startTokenRefresh();
        
        // Dispatch login event
        window.dispatchEvent(new CustomEvent('userLogin', { detail: { user } }));
    }

    /**
     * Clear authentication data
     */
    clearAuth() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('rememberMe');
        
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!(this.token && this.user);
    }

    /**
     * Check if user has specific role
     */
    hasRole(role) {
        return this.user && this.user.role === role;
    }

    /**
     * Check if user is admin
     */
    isAdmin() {
        return this.hasRole('admin');
    }

    /**
     * Get current user
     */
    getUser() {
        return this.user;
    }

    /**
     * Get current token
     */
    getToken() {
        return this.token;
    }

    /**
     * Validate current token
     */
    async validateToken() {
        if (!this.token) {
            return false;
        }

        try {
            const response = await authAPI.validateToken();
            
            if (response.data && response.data.valid) {
                // Update user data if provided
                if (response.data.user) {
                    this.user = response.data.user;
                    localStorage.setItem('user', JSON.stringify(this.user));
                    this.updateUI();
                }
                return true;
            } else {
                this.clearAuth();
                return false;
            }
        } catch (error) {
            console.error('Token validation failed:', error);
            this.clearAuth();
            return false;
        }
    }

    /**
     * Start token refresh timer
     */
    startTokenRefresh() {
        // Clear existing timer
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        // Refresh token every 30 minutes
        this.refreshTimer = setTimeout(() => {
            this.validateToken();
        }, 30 * 60 * 1000);
    }

    /**
     * Start session check interval
     */
    startSessionCheck() {
        // Check session every 5 minutes
        this.sessionCheckInterval = setInterval(() => {
            if (this.isAuthenticated()) {
                this.validateToken();
            }
        }, 5 * 60 * 1000);
    }

    /**
     * Stop session check
     */
    stopSessionCheck() {
        if (this.sessionCheckInterval) {
            clearInterval(this.sessionCheckInterval);
            this.sessionCheckInterval = null;
        }
    }

    /**
     * Update UI based on authentication state
     */
    updateUI() {
        const authButtons = document.getElementById('authButtons');
        const userMenu = document.getElementById('userMenu');
        
        if (this.isAuthenticated()) {
            // Show user menu, hide auth buttons
            if (authButtons) authButtons.style.display = 'none';
            if (userMenu) userMenu.style.display = 'block';
            
            // Update user info in UI
            this.updateUserInfo();
        } else {
            // Show auth buttons, hide user menu
            if (authButtons) authButtons.style.display = 'flex';
            if (userMenu) userMenu.style.display = 'none';
        }
    }

    /**
     * Update user information in UI
     */
    updateUserInfo() {
        if (!this.user) return;

        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');
        const userInitials = document.getElementById('userInitials');

        if (userName) userName.textContent = this.user.email;
        if (userRole) userRole.textContent = this.user.role || 'user';
        if (userInitials) {
            userInitials.textContent = this.user.email.charAt(0).toUpperCase();
        }
    }

    /**
     * Redirect to login if not authenticated
     */
    requireAuth() {
        if (!this.isAuthenticated()) {
            const currentUrl = window.location.pathname + window.location.search;
            window.location.href = `login.html?redirect=${encodeURIComponent(currentUrl)}`;
            return false;
        }
        return true;
    }

    /**
     * Require admin role
     */
    requireAdmin() {
        if (!this.requireAuth()) {
            return false;
        }
        
        if (!this.isAdmin()) {
            window.location.href = 'dashboard.html';
            return false;
        }
        
        return true;
    }

    /**
     * Handle forgot password request
     */
    async forgotPassword(email) {
        try {
            const response = await authAPI.forgotPassword(email);
            
            this.logAuthEvent('forgot_password', 'success');
            
            return {
                success: true,
                message: response.data.message || 'Password reset email sent'
            };
        } catch (error) {
            this.logAuthEvent('forgot_password', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Handle password reset
     */
    async resetPassword(token, password) {
        try {
            const response = await authAPI.resetPassword(token, password);
            
            this.logAuthEvent('reset_password', 'success');
            
            return {
                success: true,
                message: response.data.message || 'Password reset successful'
            };
        } catch (error) {
            this.logAuthEvent('reset_password', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Verify email address
     */
    async verifyEmail(token) {
        try {
            const response = await authAPI.verifyEmail(token);
            
            this.logAuthEvent('verify_email', 'success');
            
            return {
                success: true,
                message: response.data.message || 'Email verified successfully'
            };
        } catch (error) {
            this.logAuthEvent('verify_email', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Log authentication events
     */
    logAuthEvent(action, status, details = null) {
        const event = {
            action,
            status,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            details
        };
        
        console.log('Auth Event:', event);
        
        // Could send to analytics service here
    }

    /**
     * Get session information
     */
    getSessionInfo() {
        return {
            isAuthenticated: this.isAuthenticated(),
            user: this.user,
            sessionStart: localStorage.getItem('sessionStart'),
            lastActivity: localStorage.getItem('lastActivity')
        };
    }

    /**
     * Update last activity timestamp
     */
    updateActivity() {
        localStorage.setItem('lastActivity', Date.now().toString());
    }

    /**
     * Check session timeout
     */
    checkSessionTimeout() {
        const lastActivity = localStorage.getItem('lastActivity');
        if (!lastActivity) return false;

        const timeout = 24 * 60 * 60 * 1000; // 24 hours
        const elapsed = Date.now() - parseInt(lastActivity);
        
        if (elapsed > timeout) {
            this.logout();
            return true;
        }
        
        return false;
    }
}

/**
 * Hardware ID Generator
 * Generates unique hardware-based identifiers for device locking
 */
class HWIDGenerator {
    constructor() {
        this.cachedHWID = null;
    }

    /**
     * Generate hardware ID
     */
    async generate() {
        if (this.cachedHWID) {
            return this.cachedHWID;
        }

        try {
            const components = await this.gatherComponents();
            const combined = components.join('-');
            
            // Create hash of combined components
            this.cachedHWID = await this.createHash(combined);
            return this.cachedHWID;
        } catch (error) {
            console.error('HWID generation error:', error);
            // Fallback to timestamp-based ID
            this.cachedHWID = 'HWID-' + Date.now().toString(36).toUpperCase();
            return this.cachedHWID;
        }
    }

    /**
     * Gather system components for fingerprinting
     */
    async gatherComponents() {
        const components = [];

        try {
            // Screen information
            components.push(`screen-${screen.width}x${screen.height}x${screen.colorDepth}`);

            // Timezone
            components.push(`tz-${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

            // Language
            components.push(`lang-${navigator.language}`);

            // Platform
            components.push(`platform-${navigator.platform}`);

            // User Agent hash (partial to avoid full UA string)
            const uaHash = await this.simpleHash(navigator.userAgent);
            components.push(`ua-${uaHash.substring(0, 8)}`);

            // Canvas fingerprint
            const canvasFingerprint = this.getCanvasFingerprint();
            components.push(`canvas-${canvasFingerprint.substring(0, 16)}`);

            // WebGL fingerprint
            const webglFingerprint = this.getWebGLFingerprint();
            components.push(`webgl-${webglFingerprint.substring(0, 16)}`);

            // Audio context fingerprint
            const audioFingerprint = await this.getAudioFingerprint();
            components.push(`audio-${audioFingerprint.substring(0, 8)}`);

        } catch (error) {
            console.warn('Error gathering HWID components:', error);
        }

        return components;
    }

    /**
     * Create canvas fingerprint
     */
    getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Draw some shapes and text
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('CS2 Loader HWID', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Hardware ID Generation', 4, 45);
            
            const dataURL = canvas.toDataURL();
            return this.simpleHashSync(dataURL);
        } catch (error) {
            return 'canvas-error';
        }
    }

    /**
     * Create WebGL fingerprint
     */
    getWebGLFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) {
                return 'webgl-not-supported';
            }

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            let renderer = 'unknown';
            let vendor = 'unknown';

            if (debugInfo) {
                renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
                vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown';
            }

            const info = `${vendor}-${renderer}-${gl.getParameter(gl.VERSION)}`;
            return this.simpleHashSync(info);
        } catch (error) {
            return 'webgl-error';
        }
    }

    /**
     * Create audio context fingerprint
     */
    async getAudioFingerprint() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                return 'audio-not-supported';
            }

            const context = new AudioContext();
            const oscillator = context.createOscillator();
            const analyser = context.createAnalyser();
            const gainNode = context.createGain();
            const scriptProcessor = context.createScriptProcessor(4096, 1, 1);

            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(10000, context.currentTime);

            gainNode.gain.setValueAtTime(0, context.currentTime);
            oscillator.connect(analyser);
            analyser.connect(scriptProcessor);
            scriptProcessor.connect(gainNode);
            gainNode.connect(context.destination);

            oscillator.start(0);

            return new Promise((resolve) => {
                let samples = [];
                let sampleCount = 0;

                scriptProcessor.onaudioprocess = function(event) {
                    const buffer = event.inputBuffer.getChannelData(0);
                    for (let i = 0; i < buffer.length; i++) {
                        samples.push(buffer[i]);
                        sampleCount++;
                        if (sampleCount >= 1000) {
                            const fingerprint = samples.slice(0, 1000).join('');
                            oscillator.stop();
                            context.close();
                            resolve(this.simpleHashSync(fingerprint).substring(0, 8));
                            return;
                        }
                    }
                }.bind(this);

                // Fallback timeout
                setTimeout(() => {
                    oscillator.stop();
                    context.close();
                    resolve('audio-timeout');
                }, 1000);
            });
        } catch (error) {
            return 'audio-error';
        }
    }

    /**
     * Create hash using Web Crypto API
     */
    async createHash(data) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);
            const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return hashHex.substring(0, 16).toUpperCase();
        } catch (error) {
            return this.simpleHashSync(data);
        }
    }

    /**
     * Simple hash function (fallback)
     */
    async simpleHash(str) {
        return this.simpleHashSync(str);
    }

    /**
     * Simple synchronous hash function
     */
    simpleHashSync(str) {
        let hash = 0;
        if (str.length === 0) return hash.toString(36);
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return Math.abs(hash).toString(36).toUpperCase();
    }

    /**
     * Clear cached HWID
     */
    clearCache() {
        this.cachedHWID = null;
    }
}

/**
 * Session Manager
 * Handles session persistence and multi-tab synchronization
 */
class SessionManager {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.startTime = Date.now();
        
        this.init();
    }

    init() {
        this.updateSessionData();
        this.startActivityTracking();
    }

    /**
     * Generate unique session ID
     */
    generateSessionId() {
        return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Update session data
     */
    updateSessionData() {
        const sessionData = {
            id: this.sessionId,
            startTime: this.startTime,
            lastActivity: Date.now(),
            url: window.location.href,
            userAgent: navigator.userAgent
        };

        localStorage.setItem('sessionData', JSON.stringify(sessionData));
    }

    /**
     * Start activity tracking
     */
    startActivityTracking() {
        // Track user activity
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
        
        events.forEach(event => {
            document.addEventListener(event, () => {
                this.updateActivity();
            }, { passive: true });
        });

        // Update session data periodically
        setInterval(() => {
            this.updateSessionData();
        }, 30000); // Every 30 seconds
    }

    /**
     * Update last activity
     */
    updateActivity() {
        const now = Date.now();
        localStorage.setItem('lastActivity', now.toString());
        
        // Update session data less frequently to avoid performance issues
        if (now - this.lastUpdate > 10000) { // 10 seconds
            this.updateSessionData();
            this.lastUpdate = now;
        }
    }

    /**
     * Get session duration
     */
    getSessionDuration() {
        return Date.now() - this.startTime;
    }

    /**
     * Check if session is active
     */
    isActive() {
        const lastActivity = localStorage.getItem('lastActivity');
        if (!lastActivity) return false;

        const elapsed = Date.now() - parseInt(lastActivity);
        return elapsed < 30 * 60 * 1000; // 30 minutes
    }
}

// Initialize global instances
const authManager = new AuthManager();
const hwidGenerator = new HWIDGenerator();
const sessionManager = new SessionManager();

// Global functions
window.checkAuthStatus = function() {
    authManager.updateUI();
    return authManager.isAuthenticated();
};

window.requireAuth = function() {
    return authManager.requireAuth();
};

window.requireAdmin = function() {
    return authManager.requireAdmin();
};

window.logout = function() {
    authManager.logout();
};

window.getUser = function() {
    return authManager.getUser();
};

window.getToken = function() {
    return authManager.getToken();
};

window.isAdmin = function() {
    return authManager.isAdmin();
};

window.generateHWID = async function() {
    return await hwidGenerator.generate();
};

window.toggleUserDropdown = function() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
};

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const userMenu = document.querySelector('.user-menu');
    const dropdown = document.getElementById('userDropdown');
    
    if (userMenu && dropdown && !userMenu.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

// Password strength checker
window.checkPasswordStrength = function(password) {
    const checks = {
        length: password.length >= 8,
        lowercase: /[a-z]/.test(password),
        uppercase: /[A-Z]/.test(password),
        number: /\d/.test(password),
        special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };

    const score = Object.values(checks).filter(Boolean).length;
    
    let strength = 'weak';
    if (score >= 4) strength = 'strong';
    else if (score >= 3) strength = 'medium';

    return {
        score,
        strength,
        checks,
        isValid: checks.length && checks.lowercase && checks.uppercase && checks.number
    };
};

// Email validation
window.validateEmail = function(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
};

// Form validation utilities
window.validateForm = function(form) {
    const inputs = form.querySelectorAll('input[required]');
    let isValid = true;

    inputs.forEach(input => {
        const value = input.value.trim();
        
        if (!value) {
            showFieldError(input.name + 'Error', `${input.name} is required`);
            isValid = false;
        } else if (input.type === 'email' && !validateEmail(value)) {
            showFieldError(input.name + 'Error', 'Please enter a valid email address');
            isValid = false;
        } else if (input.type === 'password' && input.name === 'password') {
            const strength = checkPasswordStrength(value);
            if (!strength.isValid) {
                showFieldError(input.name + 'Error', 'Password must contain uppercase, lowercase, and number');
                isValid = false;
            }
        } else {
            clearFieldError(input.name + 'Error');
        }
    });

    return isValid;
};

window.showFieldError = function(fieldId, message) {
    const errorElement = document.getElementById(fieldId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
};

window.clearFieldError = function(fieldId) {
    const errorElement = document.getElementById(fieldId);
    if (errorElement) {
        errorElement.textContent = '';
        errorElement.style.display = 'none';
    }
};

// Export classes and instances
window.AuthManager = AuthManager;
window.HWIDGenerator = HWIDGenerator;
window.SessionManager = SessionManager;
window.authManager = authManager;
window.hwidGenerator = hwidGenerator;
window.sessionManager = sessionManager;

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', function() {
    authManager.updateUI();
    
    // Update activity on page load
    sessionManager.updateActivity();
    
    console.log('✅ Authentication system initialized');
});