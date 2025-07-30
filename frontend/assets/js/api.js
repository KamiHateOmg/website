// CS2 Loader - API Communication Utilities
// Handles all API requests, response formatting, and error handling

// Configuration
const API_CONFIG = {
    BASE_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:3000/api' 
        : '/api',
    TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000 // 1 second
};

// Make API_BASE_URL globally available
window.API_BASE_URL = API_CONFIG.BASE_URL;

/**
 * API Request Class
 * Handles HTTP requests with automatic retry, error handling, and token management
 */
class APIClient {
    constructor() {
        this.baseURL = API_CONFIG.BASE_URL;
        this.timeout = API_CONFIG.TIMEOUT;
        this.retryAttempts = API_CONFIG.RETRY_ATTEMPTS;
        this.retryDelay = API_CONFIG.RETRY_DELAY;
        
        // Request interceptors
        this.requestInterceptors = [];
        this.responseInterceptors = [];
    }

    /**
     * Add request interceptor
     */
    addRequestInterceptor(interceptor) {
        this.requestInterceptors.push(interceptor);
    }

    /**
     * Add response interceptor
     */
    addResponseInterceptor(interceptor) {
        this.responseInterceptors.push(interceptor);
    }

    /**
     * Get authentication headers
     */
    getAuthHeaders() {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return headers;
    }

    /**
     * Make HTTP request with retry logic
     */
    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
        
        // Default options
        const requestOptions = {
            method: 'GET',
            headers: this.getAuthHeaders(),
            ...options
        };

        // Apply request interceptors
        for (const interceptor of this.requestInterceptors) {
            await interceptor(requestOptions);
        }

        // Merge headers
        if (options.headers) {
            requestOptions.headers = {
                ...requestOptions.headers,
                ...options.headers
            };
        }

        let lastError;
        
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(
                    () => controller.abort(), 
                    this.timeout
                );

                const response = await fetch(url, {
                    ...requestOptions,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Apply response interceptors
                for (const interceptor of this.responseInterceptors) {
                    await interceptor(response);
                }

                // Check for authentication errors
                if (response.status === 401) {
                    this.handleAuthError();
                    throw new APIError('Authentication required', 401, 'UNAUTHORIZED');
                }

                // Parse response
                const contentType = response.headers.get('content-type');
                let data;

                if (contentType && contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    data = await response.text();
                }

                if (!response.ok) {
                    throw new APIError(
                        data.error || data.message || `HTTP ${response.status}`,
                        response.status,
                        data.code || 'API_ERROR',
                        data
                    );
                }

                return {
                    data,
                    status: response.status,
                    headers: response.headers,
                    ok: response.ok
                };

            } catch (error) {
                lastError = error;

                // Don't retry on certain errors
                if (error instanceof APIError && 
                    (error.status === 401 || error.status === 403 || error.status === 422)) {
                    throw error;
                }

                // Don't retry on abort
                if (error.name === 'AbortError') {
                    throw new APIError('Request timeout', 408, 'TIMEOUT');
                }

                // Wait before retry
                if (attempt < this.retryAttempts) {
                    await this.delay(this.retryDelay * attempt);
                }
            }
        }

        throw lastError;
    }

    /**
     * Handle authentication errors
     */
    handleAuthError() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        
        // Only redirect if not already on auth pages
        const currentPath = window.location.pathname;
        if (!currentPath.includes('login') && !currentPath.includes('register')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 1000);
        }
    }

    /**
     * Delay helper for retry logic
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // HTTP Methods
    async get(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    async post(endpoint, data = null, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'POST',
            body: data ? JSON.stringify(data) : null
        });
    }

    async put(endpoint, data = null, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PUT',
            body: data ? JSON.stringify(data) : null
        });
    }

    async patch(endpoint, data = null, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PATCH',
            body: data ? JSON.stringify(data) : null
        });
    }

    async delete(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'DELETE' });
    }
}

/**
 * Custom API Error Class
 */
class APIError extends Error {
    constructor(message, status = 500, code = 'API_ERROR', data = null) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

/**
 * API Service Classes
 */

// Authentication API
class AuthAPI {
    constructor(client) {
        this.client = client;
    }

    async login(credentials) {
        return this.client.post('/auth/login', credentials);
    }

    async register(userData) {
        return this.client.post('/auth/register', userData);
    }

    async logout() {
        return this.client.post('/auth/logout');
    }

    async validateToken() {
        return this.client.get('/auth/validate');
    }

    async forgotPassword(email) {
        return this.client.post('/auth/forgot-password', { email });
    }

    async resetPassword(token, password) {
        return this.client.post('/auth/reset-password', { token, password });
    }

    async verifyEmail(token) {
        return this.client.get(`/auth/verify-email/${token}`);
    }
}

// User API
class UserAPI {
    constructor(client) {
        this.client = client;
    }

    async getProfile() {
        return this.client.get('/users/me');
    }

    async updateProfile(data) {
        return this.client.put('/users/me', data);
    }

    async changePassword(data) {
        return this.client.post('/users/change-password', data);
    }

    async getSubscription() {
        return this.client.get('/users/subscription');
    }

    async getKeys() {
        return this.client.get('/users/keys');
    }

    async getHistory(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.client.get(`/users/history${queryString ? '?' + queryString : ''}`);
    }

    async deleteAccount() {
        return this.client.delete('/users/me');
    }
}

// Products API
class ProductsAPI {
    constructor(client) {
        this.client = client;
    }

    async getProducts() {
        return this.client.get('/products');
    }

    async getProduct(id) {
        return this.client.get(`/products/${id}`);
    }

    async purchaseProduct(id) {
        return this.client.post(`/products/${id}/purchase`);
    }
}

// Keys API
class KeysAPI {
    constructor(client) {
        this.client = client;
    }

    async redeemKey(keyCode, hwid) {
        return this.client.post('/keys/redeem', { keyCode, hwid });
    }

    async getKeyInfo(keyCode) {
        return this.client.get(`/keys/${keyCode}`);
    }
}

// Admin API
class AdminAPI {
    constructor(client) {
        this.client = client;
    }

    async getStats() {
        return this.client.get('/admin/stats');
    }

    async getUsers(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.client.get(`/admin/users${queryString ? '?' + queryString : ''}`);
    }

    async getUser(id) {
        return this.client.get(`/admin/users/${id}`);
    }

    async updateUser(id, data) {
        return this.client.put(`/admin/users/${id}`, data);
    }

    async deleteUser(id) {
        return this.client.delete(`/admin/users/${id}`);
    }

    async getKeys(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.client.get(`/admin/keys${queryString ? '?' + queryString : ''}`);
    }

    async createKeys(data) {
        return this.client.post('/admin/keys/generate', data);
    }

    async getSubscriptions(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.client.get(`/admin/subscriptions${queryString ? '?' + queryString : ''}`);
    }

    async getProducts() {
        return this.client.get('/admin/products');
    }

    async createProduct(data) {
        return this.client.post('/admin/products', data);
    }

    async updateProduct(id, data) {
        return this.client.put(`/admin/products/${id}`, data);
    }

    async deleteProduct(id) {
        return this.client.delete(`/admin/products/${id}`);
    }

    async getAuditLogs(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.client.get(`/admin/audit-logs${queryString ? '?' + queryString : ''}`);
    }
}

// System API
class SystemAPI {
    constructor(client) {
        this.client = client;
    }

    async healthCheck() {
        return this.client.get('/health');
    }

    async checkSubscription(hwid) {
        return this.client.get(`/desktop/subscription/${hwid}`);
    }
}

/**
 * Initialize API client and services
 */
const apiClient = new APIClient();

// API Services
window.authAPI = new AuthAPI(apiClient);
window.userAPI = new UserAPI(apiClient);
window.productsAPI = new ProductsAPI(apiClient);
window.keysAPI = new KeysAPI(apiClient);
window.adminAPI = new AdminAPI(apiClient);
window.systemAPI = new SystemAPI(apiClient);

// Export classes for external use
window.APIClient = APIClient;
window.APIError = APIError;

/**
 * Utility Functions
 */

// Generic error handler
function handleAPIError(error, showToast = true) {
    console.error('API Error:', error);
    
    let message = 'An unexpected error occurred';
    
    if (error instanceof APIError) {
        message = error.message;
    } else if (error.message) {
        message = error.message;
    }
    
    if (showToast && typeof showToast === 'function') {
        showToast(message, 'error');
    }
    
    return message;
}

// Format API response for consistent handling
function formatResponse(response) {
    return {
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers
    };
}

// Check if response indicates success
function isSuccess(response) {
    return response && response.ok && response.status >= 200 && response.status < 300;
}

// Extract error message from response
function extractErrorMessage(error) {
    if (error instanceof APIError) {
        return error.message;
    }
    
    if (error.response && error.response.data) {
        return error.response.data.error || error.response.data.message || 'API Error';
    }
    
    return error.message || 'Unknown error';
}

// Validate API response structure
function validateResponse(response, requiredFields = []) {
    if (!response || !response.data) {
        throw new APIError('Invalid response structure', 500, 'INVALID_RESPONSE');
    }
    
    for (const field of requiredFields) {
        if (!(field in response.data)) {
            throw new APIError(`Missing required field: ${field}`, 500, 'MISSING_FIELD');
        }
    }
    
    return true;
}

// Retry failed requests with exponential backoff
async function retryRequest(requestFn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            
            // Don't retry certain errors
            if (error instanceof APIError && 
                (error.status === 401 || error.status === 403 || error.status === 422)) {
                throw error;
            }
            
            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

// Batch API requests with concurrency control
async function batchRequests(requests, concurrency = 5) {
    const results = [];
    const errors = [];
    
    for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        
        const batchPromises = batch.map(async (request, index) => {
            try {
                const result = await request();
                return { index: i + index, result, error: null };
            } catch (error) {
                return { index: i + index, result: null, error };
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        for (const { index, result, error } of batchResults) {
            if (error) {
                errors.push({ index, error });
            } else {
                results[index] = result;
            }
        }
    }
    
    return { results, errors };
}

// Cache API responses
class APICache {
    constructor(maxSize = 100, ttl = 300000) { // 5 minutes default TTL
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
    }
    
    set(key, data) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
    
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            return null;
        }
        
        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return item.data;
    }
    
    delete(key) {
        this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
    }
    
    has(key) {
        return this.cache.has(key) && !this.isExpired(key);
    }
    
    isExpired(key) {
        const item = this.cache.get(key);
        return item && Date.now() - item.timestamp > this.ttl;
    }
}

// Global API cache instance
window.apiCache = new APICache();

// Add request interceptor for caching
apiClient.addRequestInterceptor(async (options) => {
    // Add request timestamp for debugging
    options.headers['X-Request-Time'] = Date.now().toString();
});

// Add response interceptor for error logging
apiClient.addResponseInterceptor(async (response) => {
    // Log slow responses
    const requestTime = response.headers.get('X-Request-Time');
    if (requestTime) {
        const duration = Date.now() - parseInt(requestTime);
        if (duration > 5000) { // Log requests taking more than 5 seconds
            console.warn(`Slow API request: ${duration}ms`);
        }
    }
});

// Export utility functions
window.handleAPIError = handleAPIError;
window.formatResponse = formatResponse;
window.isSuccess = isSuccess;
window.extractErrorMessage = extractErrorMessage;
window.validateResponse = validateResponse;
window.retryRequest = retryRequest;
window.batchRequests = batchRequests;
window.APICache = APICache;

console.log('✅ API client initialized successfully');