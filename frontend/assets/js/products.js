// Products Page JavaScript - Enhanced and Fixed
// Handles product display, purchasing, and modal interactions

class ProductManager {
    constructor() {
        this.products = [];
        this.selectedProduct = null;
        this.isLoading = false;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadProducts();
        this.initializeBillingToggle();
    }

    bindEvents() {
        // Close modals on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // Close modals on outside click
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeAllModals();
            }
        });
    }

    async loadProducts() {
        try {
            this.showLoading();
            
            const response = await fetch(`${API_BASE_URL}/products`, {
                headers: this.getAuthHeaders()
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.products = data.products || [];
                this.renderProducts();
                this.initializeProductCards();
            } else {
                this.showError('Failed to load products: ' + (data.error || 'Unknown error'));
                this.renderEmptyState();
            }
        } catch (error) {
            console.error('Error loading products:', error);
            this.showError('Failed to load products. Please check your connection.');
            this.renderEmptyState();
        } finally {
            this.hideLoading();
        }
    }

    renderProducts() {
        const grid = document.getElementById('productsGrid');
        
        if (!grid) {
            console.error('Products grid element not found');
            return;
        }

        if (this.products.length === 0) {
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

        grid.innerHTML = sortedProducts.map(product => this.getProductCardHTML(product)).join('');
        
        // Add entrance animations
        this.animateProductCards();
    }

    renderEmptyState() {
        const grid = document.getElementById('productsGrid');
        if (grid) {
            grid.innerHTML = this.getEmptyStateHTML();
        }
    }

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
                    <button onclick="productManager.purchaseProduct('${product.id}')" 
                            class="btn ${this.getButtonClass(product)} product-btn"
                            ${this.isLoading ? 'disabled' : ''}>
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

    getProductIcon(durationDays) {
        const icons = {
            1: `<path d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>`, // Trial
            7: `<path d="M9,10V12H7V10H9M13,10V12H11V10H13M17,10V12H15V10H17M19,3A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5C3.89,21 3,20.1 3,19V5A2,2 0 0,1 5,3H6V1H8V3H16V1H18V3H19M19,19V8H5V19H19M9,14V16H7V14H9M13,14V16H11V14H13M17,14V16H15V14H17Z"/>`, // Weekly
            30: `<path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z"/>`, // Monthly
            365: `<path d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,19H5V8H19V19M19,6H5V5H19V6Z"/>`, // Yearly
            999999: `<path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/>` // Lifetime
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
        const baseFeatures = [
            `${product.durationText} access`,
            'HWID-locked security',
            'All premium features',
            'Regular updates'
        ];

        // Add specific features based on product type
        if (product.durationDays === 999999) {
            baseFeatures.push('Lifetime updates', 'VIP support');
        } else if (product.price > 0) {
            baseFeatures.push('Priority support');
        } else {
            baseFeatures.push('Community support');
        }

        return baseFeatures;
    }

    getPricingBadges(product) {
        let badges = '';
        
        if (product.isFeatured) {
            badges += '<div class="pricing-badge featured">Recommended</div>';
        }
        
        if (product.durationDays >= 180) {
            const savings = Math.round((1 - (product.price / (product.durationDays / 30 * 29.99))) * 100);
            if (savings > 0) {
                badges += `<div class="pricing-badge savings">Save ${savings}%</div>`;
            }
        }
        
        return badges;
    }

    getButtonClass(product) {
        if (product.isFeatured) return 'btn-primary';
        if (product.price === 0) return 'btn-success';
        return 'btn-outline';
    }

    getButtonText(product) {
        if (this.isLoading) return 'Loading...';
        if (product.price === 0) return 'Get Free Trial';
        if (product.durationDays === 999999) return 'Buy Lifetime';
        return 'Purchase Now';
    }

    getEmptyStateHTML() {
        return `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19,7H22V9H19V12H17V9H14V7H17V4H19V7M12,2A3,3 0 0,1 15,5V6H19A2,2 0 0,1 21,8V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V8A2,2 0 0,1 5,6H9V5A3,3 0 0,1 12,2M12,4A1,1 0 0,0 11,5V6H13V5A1,1 0 0,0 12,4Z"/>
                    </svg>
                </div>
                <h3>No Products Available</h3>
                <p>We're currently updating our subscription plans. Please check back soon!</p>
                <button onclick="productManager.loadProducts()" class="btn btn-primary">
                    Refresh Products
                </button>
            </div>
        `;
    }

    initializeProductCards() {
        // Add hover effects
        const cards = document.querySelectorAll('.product-card');
        cards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                if (!card.classList.contains('featured')) {
                    card.style.transform = 'translateY(-8px)';
                }
            });
            
            card.addEventListener('mouseleave', () => {
                if (!card.classList.contains('featured')) {
                    card.style.transform = 'translateY(0)';
                }
            });
        });
    }

    animateProductCards() {
        const cards = document.querySelectorAll('.product-card');
        cards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                card.style.transition = 'all 0.6s ease';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, index * 100);
        });
    }

    async purchaseProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) {
            this.showError('Product not found');
            return;
        }

        // Check authentication
        const token = localStorage.getItem('token');
        if (!token) {
            // Store intended product for after login
            localStorage.setItem('intendedPurchase', productId);
            this.redirectToLogin();
            return;
        }

        this.selectedProduct = product;
        this.showPurchaseModal(product);
    }

    showPurchaseModal(product) {
        // Populate modal
        document.getElementById('modalProductName').textContent = product.name;
        document.getElementById('modalProductDescription').textContent = product.description || '';
        document.getElementById('modalDuration').textContent = product.durationText + ' access';
        document.getElementById('modalPrice').textContent = product.priceFormatted;
        
        // Show modal
        const modal = document.getElementById('purchaseModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Focus on confirm button
        setTimeout(() => {
            document.getElementById('confirmPurchaseBtn').focus();
        }, 100);
    }

    closePurchaseModal() {
        const modal = document.getElementById('purchaseModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
        this.selectedProduct = null;
    }

    async confirmPurchase() {
        if (!this.selectedProduct) return;

        const token = localStorage.getItem('token');
        if (!token) {
            this.redirectToLogin();
            return;
        }

        try {
            this.showLoading('Processing your purchase...');
            this.closePurchaseModal();

            const response = await fetch(`${API_BASE_URL}/products/${this.selectedProduct.id}/purchase`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (response.ok) {
                this.showSuccessModal(data.key.code, data.purchase);
                
                // Track purchase event
                this.trackPurchaseEvent(this.selectedProduct, data.key.code);
            } else {
                if (response.status === 401) {
                    this.redirectToLogin();
                } else {
                    this.showError(data.error || 'Purchase failed. Please try again.');
                }
            }
        } catch (error) {
            console.error('Purchase error:', error);
            this.showError('Purchase failed. Please check your connection and try again.');
        } finally {
            this.hideLoading();
        }
    }

    showSuccessModal(keyCode, purchaseInfo) {
        // Populate success modal
        document.getElementById('generatedKey').textContent = keyCode;
        
        // Add purchase info if available
        if (purchaseInfo) {
            const successModal = document.querySelector('.success-modal');
            const existingInfo = successModal.querySelector('.purchase-info');
            if (existingInfo) existingInfo.remove();
            
            const purchaseInfoHTML = `
                <div class="purchase-info">
                    <p><strong>Product:</strong> ${purchaseInfo.productName}</p>
                    <p><strong>Duration:</strong> ${purchaseInfo.durationDays === 999999 ? 'Lifetime' : purchaseInfo.durationDays + ' days'}</p>
                    <p><strong>Amount:</strong> ${purchaseInfo.price === 0 ? 'Free' : '$' + purchaseInfo.price.toFixed(2)}</p>
                </div>
            `;
            
            const keyDisplay = successModal.querySelector('.key-display');
            keyDisplay.insertAdjacentHTML('beforebegin', purchaseInfoHTML);
        }
        
        // Show modal
        const modal = document.getElementById('successModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Auto-select key for easy copying
        setTimeout(() => {
            const keyElement = document.getElementById('generatedKey');
            if (keyElement) {
                const range = document.createRange();
                range.selectNodeContents(keyElement);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }, 500);
    }

    closeSuccessModal() {
        const modal = document.getElementById('successModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
        
        // Clear purchase info
        const purchaseInfo = document.querySelector('.purchase-info');
        if (purchaseInfo) purchaseInfo.remove();
    }

    async copyKey() {
        const keyElement = document.getElementById('generatedKey');
        const key = keyElement.textContent;
        
        try {
            await navigator.clipboard.writeText(key);
            
            // Visual feedback
            const copyBtn = document.querySelector('[onclick="productManager.copyKey()"]');
            const originalHTML = copyBtn.innerHTML;
            
            copyBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/>
                </svg>
                Copied!
            `;
            copyBtn.classList.add('success');
            
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.classList.remove('success');
            }, 2000);
            
            this.showToast('Key copied to clipboard!', 'success');
        } catch (error) {
            console.error('Failed to copy key:', error);
            
            // Fallback: select text for manual copy
            const range = document.createRange();
            range.selectNodeContents(keyElement);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            
            this.showToast('Please copy the selected key manually', 'info');
        }
    }

    showProductDetails(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;
        
        // Create and show product details modal
        const detailsHTML = `
            <div id="productDetailsModal" class="modal">
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
                        <button onclick="productManager.purchaseProduct('${product.id}')" class="btn btn-primary">
                            ${this.getButtonText(product)}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing details modal
        const existingModal = document.getElementById('productDetailsModal');
        if (existingModal) existingModal.remove();
        
        // Add new modal
        document.body.insertAdjacentHTML('beforeend', detailsHTML);
        
        // Show modal
        const modal = document.getElementById('productDetailsModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeProductDetails() {
        const modal = document.getElementById('productDetailsModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            setTimeout(() => modal.remove(), 300);
        }
    }

    closeAllModals() {
        this.closePurchaseModal();
        this.closeSuccessModal();
        this.closeProductDetails();
    }

    // Handle post-login purchase if user was redirected
    handlePostLoginPurchase() {
        const intendedPurchase = localStorage.getItem('intendedPurchase');
        if (intendedPurchase) {
            localStorage.removeItem('intendedPurchase');
            setTimeout(() => {
                this.purchaseProduct(intendedPurchase);
            }, 1000);
        }
    }

    initializeBillingToggle() {
        const toggle = document.getElementById('billingToggle');
        if (toggle) {
            toggle.addEventListener('change', function() {
                // This would switch between monthly/yearly pricing
                // For now, we'll just show a message
                if (this.checked) {
                    productManager.showInfo('Yearly billing coming soon!');
                } else {
                    // Reset to monthly view
                }
            });
        }
    }

    trackPurchaseEvent(product, keyCode) {
        // Track purchase for analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'purchase', {
                transaction_id: keyCode,
                value: product.price,
                currency: 'USD',
                items: [{
                    item_id: product.id,
                    item_name: product.name,
                    category: 'Subscription',
                    quantity: 1,
                    price: product.price
                }]
            });
        }
        
        console.log('Purchase completed:', {
            product: product.name,
            price: product.price,
            keyCode: keyCode
        });
    }

    // Utility methods
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

    redirectToLogin() {
        const currentUrl = window.location.pathname + window.location.search;
        window.location.href = `../pages/login.html?redirect=${encodeURIComponent(currentUrl)}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showLoading(message = 'Loading...') {
        this.isLoading = true;
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            const text = overlay.querySelector('p');
            if (text) text.textContent = message;
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        this.isLoading = false;
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showInfo(message) {
        this.showToast(message, 'info');
    }

    showToast(message, type = 'info') {
        // Remove existing toasts
        const existingToasts = document.querySelectorAll('.toast');
        existingToasts.forEach(toast => toast.remove());
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '<path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/>',
            error: '<path d="M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>',
            info: '<path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>',
            warning: '<path d="M13,14H11V10H13M13,18H11V16H13M1,21H23L12,2L1,21Z"/>'
        };
        
        toast.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                ${icons[type] || icons.info}
            </svg>
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" class="toast-close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
                </svg>
            </button>
        `;
        
        document.body.appendChild(toast);
        
        // Show with animation
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Auto-remove after delay
        const duration = type === 'error' ? 8000 : 5000;
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, duration);
    }
}

// Initialize product manager when DOM is loaded
let productManager;

document.addEventListener('DOMContentLoaded', function() {
    productManager = new ProductManager();
    
    // Check for post-login purchase
    if (localStorage.getItem('token')) {
        productManager.handlePostLoginPurchase();
    }
});

// Global functions for inline event handlers
function toggleFAQ(button) {
    const faqItem = button.parentElement;
    const answer = faqItem.querySelector('.faq-answer');
    const icon = button.querySelector('svg');
    
    const isActive = faqItem.classList.contains('active');
    
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
    } else {
        answer.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
    }
}