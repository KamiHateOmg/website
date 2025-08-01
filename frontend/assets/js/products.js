// Products Page JavaScript - Debug Version with Comprehensive Logging
// Handles product display, purchasing, and modal interactions

class ProductManager {
    constructor() {
        console.log('🔧 ProductManager: Constructor called');
        this.products = [];
        this.selectedProduct = null;
        this.isLoading = false;
        this.isAuthenticated = false;
        
        console.log('🔧 ProductManager: Initial state:', {
            products: this.products.length,
            selectedProduct: this.selectedProduct,
            isLoading: this.isLoading,
            isAuthenticated: this.isAuthenticated
        });
        
        this.init();
    }

    init() {
        console.log('🚀 ProductManager: Initializing...');
        this.checkAuthStatus();
        this.bindEvents();
        this.loadProducts();
        this.initializeBillingToggle();
        
        // Reset loading state on init
        this.isLoading = false;
        console.log('✅ ProductManager: Initialization complete');
    }

    checkAuthStatus() {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        this.isAuthenticated = !!(token && user);
        
        console.log('🔐 Auth Status Check:', {
            hasToken: !!token,
            hasUser: !!user,
            isAuthenticated: this.isAuthenticated,
            tokenPreview: token ? token.substring(0, 20) + '...' : 'none'
        });
    }

    bindEvents() {
        console.log('🎯 ProductManager: Binding events...');
        
        // Close modals on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                console.log('⌨️ Escape key pressed, closing modals');
                this.closeAllModals();
            }
        });

        // Close modals on outside click
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                console.log('🖱️ Modal overlay clicked, closing modals');
                this.closeAllModals();
            }
        });

        // Listen for auth state changes
        window.addEventListener('userLogin', (e) => {
            console.log('👤 User login event received:', e.detail);
            this.isAuthenticated = true;
            this.updateButtonTexts();
            this.handlePostLoginPurchase();
        });

        window.addEventListener('userLogout', () => {
            console.log('👤 User logout event received');
            this.isAuthenticated = false;
            this.updateButtonTexts();
        });
        
        console.log('✅ ProductManager: Events bound successfully');
    }

    async loadProducts() {
        console.log('📦 Loading products...');
        try {
            this.showLoadingProducts();
            
            const apiUrl = `${API_BASE_URL}/products`;
            console.log('🌐 Making API request to:', apiUrl);
            
            const response = await fetch(apiUrl, {
                headers: this.getAuthHeaders()
            });
            
            console.log('📡 API Response:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });
            
            const data = await response.json();
            console.log('📊 API Data:', data);
            
            if (response.ok) {
                this.products = data.products || [];
                console.log(`✅ Products loaded successfully: ${this.products.length} products`);
                this.products.forEach((product, index) => {
                    console.log(`📦 Product ${index + 1}:`, {
                        id: product.id,
                        name: product.name,
                        price: product.price,
                        durationDays: product.durationDays
                    });
                });
                
                this.renderProducts();
                this.initializeProductCards();
            } else {
                console.error('❌ Failed to load products:', data);
                this.showError('Failed to load products: ' + (data.error || 'Unknown error'));
                this.renderEmptyState();
            }
        } catch (error) {
            console.error('💥 Error loading products:', error);
            this.showError('Failed to load products. Please check your connection.');
            this.renderEmptyState();
        } finally {
            this.hideLoadingProducts();
        }
    }

    renderProducts() {
        console.log('🎨 Rendering products...');
        const grid = document.getElementById('productsGrid');
        
        if (!grid) {
            console.error('❌ Products grid element not found!');
            return;
        }

        if (this.products.length === 0) {
            console.log('📦 No products to render, showing empty state');
            this.renderEmptyState();
            return;
        }

        // Sort products by display order and price
        const sortedProducts = this.products.sort((a, b) => {
            if (a.displayOrder !== b.displayOrder) {
                return a.displayOrder - b.displayOrder;
            }
            return a.price - b.price;
        });

        console.log('📦 Products sorted, generating HTML...');
        grid.innerHTML = sortedProducts.map(product => this.getProductCardHTML(product)).join('');
        
        console.log('✅ Products rendered successfully');
        this.animateProductCards();
    }

    // Handle both login redirect and purchase
    handleProductAction(productId) {
        console.log('🎯 handleProductAction called:', {
            productId,
            isLoading: this.isLoading,
            isAuthenticated: this.isAuthenticated
        });
        
        if (this.isLoading) {
            console.log('⏳ Action blocked - already loading');
            return;
        }
        
        const product = this.products.find(p => p.id === productId);
        if (!product) {
            console.error('❌ Product not found for ID:', productId);
            this.showError('Product not found');
            return;
        }
        
        console.log('📦 Product found:', product.name);
        
        if (this.isAuthenticated) {
            console.log('✅ User authenticated, proceeding with purchase');
            this.purchaseProduct(productId);
        } else {
            console.log('🔐 User not authenticated, redirecting to login');
            // Store intended product for after login
            localStorage.setItem('intendedPurchase', productId);
            this.redirectToLogin();
        }
    }

    async purchaseProduct(productId) {
        console.log('💳 purchaseProduct called:', {
            productId,
            isLoading: this.isLoading,
            selectedProduct: this.selectedProduct
        });
        
        if (this.isLoading) {
            console.log('⏳ Purchase blocked - already loading');
            return;
        }
        
        const product = this.products.find(p => p.id === productId);
        if (!product) {
            console.error('❌ Product not found for purchase:', productId);
            this.showError('Product not found');
            return;
        }

        console.log('📦 Product found for purchase:', product.name);

        // Check authentication again
        if (!this.isAuthenticated) {
            console.log('🔐 User not authenticated during purchase, redirecting');
            localStorage.setItem('intendedPurchase', productId);
            this.redirectToLogin();
            return;
        }

        // Store selected product BEFORE showing modal
        this.selectedProduct = product;
        console.log('✅ Selected product set:', {
            selectedProductId: this.selectedProduct.id,
            selectedProductName: this.selectedProduct.name
        });
        
        this.showPurchaseModal(product);
    }

    showPurchaseModal(product) {
        console.log('💳 showPurchaseModal called:', product.name);
        
        // Close any existing modals first - THIS IS THE FIX!
        this.closeProductDetails();
        
        // Populate modal
        const modalProductName = document.getElementById('modalProductName');
        const modalProductDescription = document.getElementById('modalProductDescription');
        const modalDuration = document.getElementById('modalDuration');
        const modalPrice = document.getElementById('modalPrice');
        
        console.log('🔧 Modal elements found:', {
            modalProductName: !!modalProductName,
            modalProductDescription: !!modalProductDescription,
            modalDuration: !!modalDuration,
            modalPrice: !!modalPrice
        });
        
        if (modalProductName) modalProductName.textContent = product.name;
        if (modalProductDescription) modalProductDescription.textContent = product.description || '';
        if (modalDuration) modalDuration.textContent = product.durationText + ' access';
        if (modalPrice) modalPrice.textContent = product.priceFormatted;
        
        // Show modal
        const modal = document.getElementById('purchaseModal');
        if (modal) {
            console.log('✅ Showing purchase modal');
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            
            // Focus on confirm button
            setTimeout(() => {
                const confirmBtn = document.getElementById('confirmPurchaseBtn');
                if (confirmBtn) {
                    console.log('🎯 Focusing confirm button');
                    confirmBtn.focus();
                }
            }, 100);
        } else {
            console.error('❌ Purchase modal not found in DOM!');
        }
    }

    closePurchaseModal() {
        console.log('❌ Closing purchase modal');
        const modal = document.getElementById('purchaseModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            console.log('✅ Purchase modal closed');
        }
        this.selectedProduct = null;
        console.log('🔄 Selected product cleared');
    }

    async confirmPurchase() {
        console.log('💳 confirmPurchase called:', {
            selectedProduct: this.selectedProduct,
            isAuthenticated: this.isAuthenticated
        });
        
        if (!this.selectedProduct) {
            console.error('❌ No product selected for purchase!');
            this.showError('No product selected');
            return;
        }

        if (!this.isAuthenticated) {
            console.log('🔐 User not authenticated during confirm, redirecting');
            this.redirectToLogin();
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            console.error('❌ No token found during purchase!');
            this.redirectToLogin();
            return;
        }

        try {
            console.log('⏳ Starting purchase process...');
            this.showLoading('Processing your purchase...');
            this.closePurchaseModal();

            const apiUrl = `${API_BASE_URL}/products/${this.selectedProduct.id}/purchase`;
            console.log('🌐 Making purchase API call to:', apiUrl);

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('📡 Purchase API Response:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });

            const data = await response.json();
            console.log('📊 Purchase API Data:', data);

            if (response.ok) {
                console.log('✅ Purchase successful!');
                this.showSuccessModal(data.key.code, data.purchase);
                
                // Track purchase event
                this.trackPurchaseEvent(this.selectedProduct, data.key.code);
            } else {
                console.error('❌ Purchase failed:', data);
                if (response.status === 401) {
                    console.log('🔐 Token expired, clearing auth and redirecting');
                    this.isAuthenticated = false;
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    this.redirectToLogin();
                } else {
                    this.showError(data.error || 'Purchase failed. Please try again.');
                }
            }
        } catch (error) {
            console.error('💥 Purchase error:', error);
            this.showError('Purchase failed. Please check your connection and try again.');
        } finally {
            this.hideLoading();
            console.log('🔄 Purchase process completed');
        }
    }

    showProductDetails(productId) {
        console.log('📋 showProductDetails called:', productId);
        
        const product = this.products.find(p => p.id === productId);
        if (!product) {
            console.error('❌ Product not found for details:', productId);
            return;
        }
        
        console.log('📦 Product found for details:', product.name);
        
        // Create and show product details modal
        const detailsHTML = `
            <div id="productDetailsModal" class="modal" style="z-index: 10001;">
                <div class="modal-overlay" onclick="productManager.closeProductDetails()"></div>
                <div class="modal-content product-details-modal">
                    <div class="modal-header">
                        <h3>${this.escapeHtml(product.name)}</h3>
                        <button onclick="productManager.closeProductDetails()" class="modal-close">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="product-details-content">
                            <div class="detail-section">
                                <h4>Description</h4>
                                <p>${this.escapeHtml(product.description || 'Full access to CS2 Loader with premium features.')}</p>
                            </div>
                            
                            <div class="detail-section">
                                <h4>What's Included</h4>
                                <ul class="feature-list">
                                    ${this.getProductFeatures(product).map(feature => `<li>${feature}</li>`).join('')}
                                </ul>
                            </div>
                            
                            <div class="detail-section">
                                <h4>Pricing Details</h4>
                                <div class="pricing-breakdown">
                                    <div class="pricing-row">
                                        <span>Duration:</span>
                                        <span>${product.durationText}</span>
                                    </div>
                                    <div class="pricing-row">
                                        <span>Price:</span>
                                        <span>${product.priceFormatted}</span>
                                    </div>
                                    <div class="pricing-row">
                                        <span>Type:</span>
                                        <span>${product.price === 0 ? 'Free Trial' : 'One-time Purchase'}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="detail-section">
                                <h4>Security</h4>
                                <ul class="security-list">
                                    <li>HWID-locked to your specific hardware</li>
                                    <li>Encrypted key authentication</li>
                                    <li>Secure web-based management</li>
                                    <li>Anti-detection technology</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button onclick="productManager.closeProductDetails()" class="btn btn-outline">Close</button>
                        <button onclick="productManager.handleProductAction('${product.id}')" class="btn btn-primary">
                            ${this.getButtonText(product)}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing details modal
        const existingModal = document.getElementById('productDetailsModal');
        if (existingModal) {
            console.log('🗑️ Removing existing details modal');
            existingModal.remove();
        }
        
        // Add new modal
        document.body.insertAdjacentHTML('beforeend', detailsHTML);
        console.log('✅ Product details modal added to DOM');
        
        // Show modal
        const modal = document.getElementById('productDetailsModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        console.log('✅ Product details modal displayed');
    }

    closeProductDetails() {
        console.log('❌ Closing product details modal');
        const modal = document.getElementById('productDetailsModal');
        if (modal) {
            modal.style.display = 'none';
            console.log('✅ Product details modal hidden');
            
            // Only reset overflow if no other modals are open
            const otherModals = document.querySelectorAll('.modal[style*="flex"]');
            console.log('🔍 Other open modals:', otherModals.length);
            
            if (otherModals.length <= 1) { // Only this modal
                document.body.style.overflow = 'auto';
                console.log('🔄 Body overflow reset to auto');
            }
            
            setTimeout(() => {
                if (modal.parentElement) {
                    modal.remove();
                    console.log('🗑️ Product details modal removed from DOM');
                }
            }, 300);
        } else {
            console.log('⚠️ Product details modal not found when trying to close');
        }
    }

    closeAllModals() {
        console.log('❌ Closing all modals');
        this.closePurchaseModal();
        this.closeSuccessModal();
        this.closeProductDetails();
    }

    getButtonText(product) {
        console.log('🔤 getButtonText called:', {
            productName: product.name,
            isLoading: this.isLoading,
            isAuthenticated: this.isAuthenticated,
            price: product.price
        });
        
        if (this.isLoading) {
            console.log('⏳ Returning loading text');
            return 'Loading...';
        }
        
        if (!this.isAuthenticated) {
            console.log('🔐 Returning login text');
            return 'Login to Purchase';
        }
        
        if (product.price === 0) {
            console.log('🆓 Returning free trial text');
            return 'Get Free Trial';
        }
        
        if (product.durationDays === 999999) {
            console.log('♾️ Returning lifetime text');
            return 'Buy Lifetime';
        }
        
        console.log('💳 Returning purchase text');
        return 'Purchase Now';
    }

    // Update button texts when auth status changes
    updateButtonTexts() {
        console.log('🔄 Updating button texts, isAuthenticated:', this.isAuthenticated);
        const buttons = document.querySelectorAll('.product-btn');
        console.log(`🔍 Found ${buttons.length} product buttons to update`);
        
        buttons.forEach((button, index) => {
            const productId = button.getAttribute('data-product-id');
            const product = this.products.find(p => p.id === productId);
            if (product) {
                const newText = this.getButtonText(product);
                const oldText = button.textContent;
                button.textContent = newText;
                console.log(`🔄 Button ${index + 1} updated: "${oldText}" → "${newText}"`);
            }
        });
    }

    // Handle post-login purchase if user was redirected
    handlePostLoginPurchase() {
        console.log('🔐 Checking for post-login purchase...');
        const intendedPurchase = localStorage.getItem('intendedPurchase');
        if (intendedPurchase) {
            console.log('🎯 Found intended purchase:', intendedPurchase);
            localStorage.removeItem('intendedPurchase');
            setTimeout(() => {
                console.log('⏳ Executing post-login purchase...');
                this.purchaseProduct(intendedPurchase);
            }, 1000);
        } else {
            console.log('ℹ️ No intended purchase found');
        }
    }

    // Placeholder methods for the remaining functionality
    getProductCardHTML(product) {
        const isLifetime = product.durationDays === 999999;
        const isFree = product.price === 0;
        
        return `
            <div class="product-card ${product.isFeatured ? 'featured' : ''}" 
                 data-product-id="${product.id}"
                 data-aos="fade-up"
                 data-aos-delay="${product.displayOrder * 100}">
                
                ${product.isFeatured ? '<div class="product-badge">Most Popular</div>' : ''}
                ${isFree ? '<div class="product-badge free">Free Trial</div>' : ''}
                ${isLifetime ? '<div class="product-badge lifetime">Lifetime</div>' : ''}
                
                <div class="product-header">
                    <div class="product-icon ${this.getProductIconClass(product.durationDays)}">
                        ${this.getProductIcon(product.durationDays)}
                    </div>
                    <h3 class="product-name">${this.escapeHtml(product.name)}</h3>
                    <p class="product-description">${this.escapeHtml(product.description || '')}</p>
                </div>
                
                <div class="product-pricing">
                    <div class="price-display">
                        <span class="price">${product.priceFormatted}</span>
                        <span class="period">/ ${product.durationText.toLowerCase()}</span>
                    </div>
                    <div class="price-note">
                        ${isFree ? 'No payment required' : 
                          isLifetime ? 'One-time payment' : 
                          'One-time purchase'}
                    </div>
                    ${this.getPricingBadges(product)}
                </div>
                
                <div class="product-features">
                    ${this.getProductFeatures(product).map(feature => `
                        <div class="feature">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/>
                            </svg>
                            <span>${feature}</span>
                        </div>
                    `).join('')}
                </div>
                
                <div class="product-actions">
                    <button onclick="productManager.handleProductAction('${product.id}')" 
                            class="btn ${this.getButtonClass(product)} product-btn"
                            data-product-id="${product.id}">
                        ${this.getButtonText(product)}
                    </button>
                    
                    <button onclick="productManager.showProductDetails('${product.id}')" 
                            class="btn btn-ghost btn-small">
                        View Details
                    </button>
                </div>
            </div>
        `;
    }

    // Utility and helper methods
    getProductIcon(durationDays) {
        const icons = {
            1: `<path d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>`,
            7: `<path d="M9,10V12H7V10H9M13,10V12H11V10H13M17,10V12H15V10H17M19,3A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5C3.89,21 3,20.1 3,19V5A2,2 0 0,1 5,3H6V1H8V3H16V1H18V3H19M19,19V8H5V19H19M9,14V16H7V14H9M13,14V16H11V14H13M17,14V16H15V14H17Z"/>`,
            30: `<path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z"/>`,
            365: `<path d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,19H5V8H19V19M19,6H5V5H19V6Z"/>`,
            999999: `<path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/>`
        };

        const iconPath = icons[durationDays] || icons[30];
        return `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">${iconPath}</svg>`;
    }

    getProductIconClass(durationDays) {
        if (durationDays === 1) return 'trial';
        if (durationDays <= 7) return 'weekly';
        if (durationDays <= 30) return 'monthly';
        if (durationDays <= 365) return 'yearly';
        return 'lifetime';
    }

    getProductFeatures(product) {
        return [
            `${product.durationText} access`,
            'HWID-locked security',
            'All premium features',
            'Regular updates',
            product.durationDays === 999999 ? 'VIP support' : 'Priority support'
        ];
    }

    getPricingBadges(product) {
        let badges = '';
        if (product.isFeatured) {
            badges += '<div class="pricing-badge featured">Recommended</div>';
        }
        return badges;
    }

    getButtonClass(product) {
        if (product.isFeatured) return 'btn-primary';
        if (product.price === 0) return 'btn-success';
        return 'btn-outline';
    }

    renderEmptyState() {
        const grid = document.getElementById('productsGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="empty-state">
                    <h3>No Products Available</h3>
                    <p>Loading subscription plans...</p>
                </div>
            `;
        }
    }

    initializeProductCards() {
        console.log('🎨 Initializing product card interactions');
    }

    animateProductCards() {
        console.log('✨ Animating product cards');
    }

    showLoadingProducts() {
        console.log('⏳ Showing products loading state');
        const grid = document.getElementById('productsGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="loading-products">
                    <div class="spinner"></div>
                    <p>Loading subscription plans...</p>
                </div>
            `;
        }
    }

    hideLoadingProducts() {
        console.log('✅ Hiding products loading state');
    }

    showLoading(message = 'Loading...') {
        console.log('⏳ Showing full loading overlay:', message);
        this.isLoading = true;
        
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            const text = overlay.querySelector('p');
            if (text) text.textContent = message;
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        console.log('✅ Hiding full loading overlay');
        this.isLoading = false;
        
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showSuccessModal(keyCode, purchaseInfo) {
        console.log('🎉 Showing success modal:', keyCode);
        const modal = document.getElementById('successModal');
        if (modal) {
            document.getElementById('generatedKey').textContent = keyCode;
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    closeSuccessModal() {
        console.log('❌ Closing success modal');
        const modal = document.getElementById('successModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }

    getAuthHeaders() {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    redirectToLogin() {
        console.log('🔐 Redirecting to login');
        const currentUrl = window.location.pathname + window.location.search;
        window.location.href = `../pages/login.html?redirect=${encodeURIComponent(currentUrl)}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        console.error('❌ Error:', message);
        alert('Error: ' + message); // Temporary simple error display
    }

    showToast(message, type) {
        console.log(`📢 Toast (${type}):`, message);
        alert(`${type.toUpperCase()}: ${message}`); // Temporary simple toast
    }

    initializeBillingToggle() {
        console.log('💰 Initializing billing toggle');
    }

    trackPurchaseEvent(product, keyCode) {
        console.log('📊 Tracking purchase event:', { product: product.name, keyCode });
    }

    async copyKey() {
        console.log('📋 Copy key function called');
    }
}

// Initialize product manager when DOM is loaded
let productManager;

document.addEventListener('DOMContentLoaded', function() {
    console.log('🌐 DOM Content Loaded - Initializing ProductManager');
    
    // Check if API_BASE_URL is available
    console.log('🔧 Environment check:', {
        API_BASE_URL: typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'UNDEFINED',
        localStorage_token: !!localStorage.getItem('token'),
        localStorage_user: !!localStorage.getItem('user')
    });
    
    try {
        productManager = new ProductManager();
        console.log('✅ ProductManager initialized successfully');
        
        // Check for post-login purchase
        const token = localStorage.getItem('token');
        if (token) {
            console.log('🔐 Token found, checking for post-login purchase');
            productManager.handlePostLoginPurchase();
        } else {
            console.log('ℹ️ No token found');
        }
        
        // Make productManager globally available for debugging
        window.debugProductManager = productManager;
        console.log('🔧 ProductManager available globally as window.debugProductManager');
        
    } catch (error) {
        console.error('💥 Failed to initialize ProductManager:', error);
    }
});

// Global functions for inline event handlers with logging
function toggleFAQ(button) {
    console.log('❓ FAQ toggle clicked');
    const faqItem = button.parentElement;
    const answer = faqItem.querySelector('.faq-answer');
    const icon = button.querySelector('svg');
    
    const isActive = faqItem.classList.contains('active');
    console.log('❓ FAQ state:', { isActive });
    
    // Close all other FAQ items
    document.querySelectorAll('.faq-item.active').forEach(item => {
        if (item !== faqItem) {
            item.classList.remove('active');
            item.querySelector('.faq-answer').style.maxHeight = '0px';
            item.querySelector('svg').style.transform = 'rotate(0deg)';
        }
    });
    
    // Toggle current item
    faqItem.classList.toggle('active');
    
    if (!isActive) {
        answer.style.maxHeight = answer.scrollHeight + 'px';
        icon.style.transform = 'rotate(180deg)';
        console.log('❓ FAQ opened');
    } else {
        answer.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
        console.log('❓ FAQ closed');
    }
}

// Debug helper functions
window.debugProductManagerState = function() {
    if (productManager) {
        console.log('🔧 ProductManager Debug State:', {
            products: productManager.products,
            selectedProduct: productManager.selectedProduct,
            isLoading: productManager.isLoading,
            isAuthenticated: productManager.isAuthenticated
        });
    } else {
        console.log('❌ ProductManager not initialized');
    }
};

window.debugCheckModals = function() {
    const purchaseModal = document.getElementById('purchaseModal');
    const successModal = document.getElementById('successModal');
    const detailsModal = document.getElementById('productDetailsModal');
    
    console.log('🔧 Modal Debug State:', {
        purchaseModal: {
            exists: !!purchaseModal,
            display: purchaseModal ? purchaseModal.style.display : 'n/a'
        },
        successModal: {
            exists: !!successModal,
            display: successModal ? successModal.style.display : 'n/a'
        },
        detailsModal: {
            exists: !!detailsModal,
            display: detailsModal ? detailsModal.style.display : 'n/a'
        }
    });
};

window.debugForceCloseModals = function() {
    console.log('🔧 Force closing all modals');
    if (productManager) {
        productManager.closeAllModals();
    }
};

console.log('📝 Products.js debug version loaded with comprehensive logging');