// CS2 Loader - Main Site Functionality
// Handles global site functionality, animations, and shared utilities

/**
 * Main Site Controller
 * Manages global site functionality and shared components
 */
class SiteController {
    constructor() {
        this.isLoading = false;
        this.toasts = [];
        this.animations = new Map();
        this.scrollPosition = 0;
        
        this.init();
    }

    /**
     * Initialize site controller
     */
    init() {
        this.setupGlobalEvents();
        this.initializeAnimations();
        this.setupScrollHandler();
        this.setupFormValidation();
        this.setupNavigationHighlight();
        this.createParticleEffects();
        this.setupPerformanceMonitoring();
    }

    /**
     * Setup global event listeners
     */
    setupGlobalEvents() {
        // Page visibility changes
        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        
        // Online/offline status
        window.addEventListener('online', this.handleOnline.bind(this));
        window.addEventListener('offline', this.handleOffline.bind(this));
        
        // Resize handling
        window.addEventListener('resize', this.debounce(this.handleResize.bind(this), 250));
        
        // Before unload
        window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
        
        // Global keyboard shortcuts
        document.addEventListener('keydown', this.handleGlobalShortcuts.bind(this));
        
        // Error handling
        window.addEventListener('error', this.handleGlobalError.bind(this));
        window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
    }

    /**
     * Initialize animations
     */
    initializeAnimations() {
        // Intersection Observer for scroll animations
        this.observeElements();
        
        // Counter animations
        this.initCounterAnimations();
        
        // Page transitions
        this.setupPageTransitions();
        
        // Loading animations
        this.setupLoadingAnimations();
    }

    /**
     * Setup scroll handler
     */
    setupScrollHandler() {
        let ticking = false;
        
        const handleScroll = () => {
            this.scrollPosition = window.pageYOffset;
            this.updateScrollElements();
            ticking = false;
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(handleScroll);
                ticking = true;
            }
        }, { passive: true });
    }

    /**
     * Update elements based on scroll position
     */
    updateScrollElements() {
        // Navbar background opacity
        const navbar = document.querySelector('.navbar');
        if (navbar) {
            const opacity = Math.min(this.scrollPosition / 100, 0.95);
            navbar.style.backgroundColor = `rgba(13, 17, 23, ${opacity})`;
        }

        // Parallax effects
        this.updateParallaxElements();
        
        // Progress indicators
        this.updateProgressIndicators();
    }

    /**
     * Setup form validation
     */
    setupFormValidation() {
        // Real-time validation for all forms
        document.addEventListener('input', (e) => {
            if (e.target.matches('input, textarea, select')) {
                this.validateField(e.target);
            }
        });

        // Form submission handling
        document.addEventListener('submit', (e) => {
            if (!e.target.hasAttribute('data-skip-validation')) {
                if (!this.validateForm(e.target)) {
                    e.preventDefault();
                }
            }
        });
    }

    /**
     * Setup navigation highlighting
     */
    setupNavigationHighlight() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-link[href^="#"]');

        if (sections.length === 0 || navLinks.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.id;
                    this.updateActiveNavLink(id);
                }
            });
        }, {
            threshold: 0.3,
            rootMargin: '-20% 0px -70% 0px'
        });

        sections.forEach(section => observer.observe(section));
    }

    /**
     * Create particle effects
     */
    createParticleEffects() {
        const particleContainers = document.querySelectorAll('.hero-particles, .auth-particles');
        
        particleContainers.forEach(container => {
            this.createParticlesInContainer(container);
        });
    }

    /**
     * Create particles in specific container
     */
    createParticlesInContainer(container, count = 50) {
        if (!container) return;

        // Clear existing particles
        container.innerHTML = '';

        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            
            // Random properties
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 10 + 's';
            particle.style.animationDuration = (Math.random() * 10 + 5) + 's';
            particle.style.opacity = Math.random() * 0.6 + 0.2;
            
            container.appendChild(particle);
        }
    }

    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        // Monitor page load time
        if ('performance' in window) {
            window.addEventListener('load', () => {
                setTimeout(() => {
                    const timing = performance.timing;
                    const loadTime = timing.loadEventEnd - timing.navigationStart;
                    console.log(`Page load time: ${loadTime}ms`);
                    
                    // Log slow page loads
                    if (loadTime > 3000) {
                        console.warn('Slow page load detected');
                    }
                }, 0);
            });
        }

        // Monitor memory usage (if available)
        if ('memory' in performance) {
            setInterval(() => {
                const memory = performance.memory;
                const memoryUsage = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
                
                if (memoryUsage > 0.9) {
                    console.warn('High memory usage detected');
                }
            }, 30000); // Check every 30 seconds
        }
    }

    /**
     * Observe elements for animations
     */
    observeElements() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.animateElement(entry.target);
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });

        // Observe elements with animation data attributes
        const animatedElements = document.querySelectorAll('[data-animate]');
        animatedElements.forEach(el => {
            observer.observe(el);
        });

        // Observe common animated elements
        const commonElements = document.querySelectorAll(
            '.feature-card, .pricing-card, .stat-card, .product-card, .hero-visual'
        );
        commonElements.forEach(el => {
            observer.observe(el);
        });
    }

    /**
     * Animate element
     */
    animateElement(element) {
        const animationType = element.dataset.animate || 'fadeInUp';
        const delay = parseInt(element.dataset.delay) || 0;
        
        setTimeout(() => {
            element.classList.add('animate', animationType);
        }, delay);
    }

    /**
     * Initialize counter animations
     */
    initCounterAnimations() {
        const counters = document.querySelectorAll('[data-count]');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.animateCounter(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        });

        counters.forEach(counter => observer.observe(counter));
    }

    /**
     * Animate counter
     */
    animateCounter(element) {
        const target = parseFloat(element.dataset.count);
        const duration = parseInt(element.dataset.duration) || 2000;
        const increment = target / (duration / 16);
        let current = 0;

        const timer = setInterval(() => {
            current += increment;
            
            if (current >= target) {
                element.textContent = this.formatCounterValue(target);
                clearInterval(timer);
            } else {
                element.textContent = this.formatCounterValue(current);
            }
        }, 16);
    }

    /**
     * Format counter value
     */
    formatCounterValue(value) {
        if (value === 99.9) return '99.9';
        if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
        return Math.floor(value).toString();
    }

    /**
     * Setup page transitions
     */
    setupPageTransitions() {
        // Handle internal navigation
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (link && this.isInternalLink(link)) {
                this.handleInternalNavigation(e, link);
            }
        });
    }

    /**
     * Check if link is internal
     */
    isInternalLink(link) {
        const href = link.getAttribute('href');
        return href.startsWith('/') || 
               href.startsWith('./') || 
               href.startsWith('../') ||
               (href.includes(window.location.hostname) && !href.includes('#'));
    }

    /**
     * Handle internal navigation
     */
    handleInternalNavigation(event, link) {
        // Skip if modifier keys are pressed
        if (event.ctrlKey || event.metaKey || event.shiftKey) return;
        
        event.preventDefault();
        
        const href = link.getAttribute('href');
        this.navigateToPage(href);
    }

    /**
     * Navigate to page with transition
     */
    async navigateToPage(href) {
        // Add loading state
        this.showPageTransition();
        
        try {
            // Small delay for visual effect
            await new Promise(resolve => setTimeout(resolve, 300));
            window.location.href = href;
        } catch (error) {
            this.hidePageTransition();
            console.error('Navigation error:', error);
        }
    }

    /**
     * Setup loading animations
     */
    setupLoadingAnimations() {
        // Loader preview animation
        const loaderPreviews = document.querySelectorAll('.loader-preview');
        loaderPreviews.forEach(preview => {
            this.animateLoaderPreview(preview);
        });
    }

    /**
     * Animate loader preview
     */
    animateLoaderPreview(preview) {
        const progressFill = preview.querySelector('.progress-fill');
        const statusDot = preview.querySelector('.status-dot');
        
        if (!progressFill) return;

        const animate = () => {
            // Reset progress
            progressFill.style.width = '0%';
            if (statusDot) statusDot.classList.remove('pulsing');
            
            setTimeout(() => {
                // Start progress animation
                progressFill.style.transition = 'width 2s ease-out';
                progressFill.style.width = '100%';
                if (statusDot) statusDot.classList.add('pulsing');
            }, 500);
        };

        // Initial animation
        setTimeout(animate, 1000);
        
        // Repeat animation
        setInterval(animate, 4000);
    }

    /**
     * Update parallax elements
     */
    updateParallaxElements() {
        const parallaxElements = document.querySelectorAll('[data-parallax]');
        
        parallaxElements.forEach(element => {
            const speed = parseFloat(element.dataset.parallax) || 0.5;
            const yPos = -(this.scrollPosition * speed);
            element.style.transform = `translateY(${yPos}px)`;
        });
    }

    /**
     * Update progress indicators
     */
    updateProgressIndicators() {
        const progressBars = document.querySelectorAll('.scroll-progress');
        const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = (this.scrollPosition / documentHeight) * 100;
        
        progressBars.forEach(bar => {
            bar.style.width = `${Math.min(progress, 100)}%`;
        });
    }

    /**
     * Update active navigation link
     */
    updateActiveNavLink(activeId) {
        const navLinks = document.querySelectorAll('.nav-link');
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            
            const href = link.getAttribute('href');
            if (href === `#${activeId}`) {
                link.classList.add('active');
            }
        });
    }

    /**
     * Validate field
     */
    validateField(field) {
        const value = field.value.trim();
        const type = field.type;
        const required = field.hasAttribute('required');
        
        // Clear previous errors
        this.clearFieldError(field);
        
        // Required field validation
        if (required && !value) {
            this.showFieldError(field, 'This field is required');
            return false;
        }
        
        // Type-specific validation
        if (value) {
            switch (type) {
                case 'email':
                    if (!this.validateEmail(value)) {
                        this.showFieldError(field, 'Please enter a valid email address');
                        return false;
                    }
                    break;
                    
                case 'password':
                    if (field.name === 'password' && value.length < 8) {
                        this.showFieldError(field, 'Password must be at least 8 characters long');
                        return false;
                    }
                    break;
                    
                case 'url':
                    if (!this.validateURL(value)) {
                        this.showFieldError(field, 'Please enter a valid URL');
                        return false;
                    }
                    break;
            }
        }
        
        // Custom validation patterns
        const pattern = field.getAttribute('pattern');
        if (pattern && value && !new RegExp(pattern).test(value)) {
            const title = field.getAttribute('title') || 'Please match the required format';
            this.showFieldError(field, title);
            return false;
        }
        
        return true;
    }

    /**
     * Validate entire form
     */
    validateForm(form) {
        const fields = form.querySelectorAll('input, textarea, select');
        let isValid = true;
        
        fields.forEach(field => {
            if (!this.validateField(field)) {
                isValid = false;
            }
        });
        
        return isValid;
    }

    /**
     * Show field error
     */
    showFieldError(field, message) {
        field.classList.add('error');
        
        const errorId = field.name + 'Error';
        let errorElement = document.getElementById(errorId);
        
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = errorId;
            errorElement.className = 'form-error';
            field.parentNode.appendChild(errorElement);
        }
        
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }

    /**
     * Clear field error
     */
    clearFieldError(field) {
        field.classList.remove('error');
        
        const errorId = field.name + 'Error';
        const errorElement = document.getElementById(errorId);
        
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }

    /**
     * Email validation
     */
    validateEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }

    /**
     * URL validation
     */
    validateURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Show page transition
     */
    showPageTransition() {
        const overlay = document.getElementById('pageTransitionOverlay') || this.createTransitionOverlay();
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide page transition
     */
    hidePageTransition() {
        const overlay = document.getElementById('pageTransitionOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }

    /**
     * Create transition overlay
     */
    createTransitionOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'pageTransitionOverlay';
        overlay.className = 'page-transition-overlay';
        overlay.innerHTML = `
            <div class="transition-spinner">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
        
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Event Handlers
     */
    handleVisibilityChange() {
        if (document.hidden) {
            // Page is hidden
            console.log('Page hidden');
        } else {
            // Page is visible
            console.log('Page visible');
        }
    }

    handleOnline() {
        this.showToast('Connection restored', 'success');
        console.log('Online');
    }

    handleOffline() {
        this.showToast('Connection lost', 'warning');
        console.log('Offline');
    }

    handleResize() {
        // Update particle effects for new viewport
        const particleContainers = document.querySelectorAll('.hero-particles, .auth-particles');
        particleContainers.forEach(container => {
            if (container.children.length > 0) {
                this.createParticlesInContainer(container);
            }
        });

        // Update any responsive calculations
        this.updateResponsiveElements();
    }

    handleBeforeUnload(event) {
        // Check for unsaved changes
        const forms = document.querySelectorAll('form[data-warn-unsaved]');
        
        for (const form of forms) {
            if (this.hasUnsavedChanges(form)) {
                event.preventDefault();
                event.returnValue = '';
                return '';
            }
        }
    }

    handleGlobalShortcuts(event) {
        // Global keyboard shortcuts
        if (event.ctrlKey || event.metaKey) {
            switch (event.key) {
                case '/':
                    event.preventDefault();
                    this.focusSearchInput();
                    break;
                    
                case 'k':
                    if (!event.target.matches('input, textarea')) {
                        event.preventDefault();
                        this.openQuickActions();
                    }
                    break;
            }
        }
        
        // Escape key
        if (event.key === 'Escape') {
            this.closeModalsAndDropdowns();
        }
    }

    handleGlobalError(event) {
        console.error('Global error:', event.error);
        
        // Don't show toast for script loading errors
        if (!event.filename || event.filename.includes('.js')) {
            return;
        }
        
        this.showToast('An unexpected error occurred', 'error');
    }

    handleUnhandledRejection(event) {
        console.error('Unhandled promise rejection:', event.reason);
        this.showToast('An unexpected error occurred', 'error');
    }

    /**
     * Utility Functions
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    hasUnsavedChanges(form) {
        const inputs = form.querySelectorAll('input, textarea, select');
        return Array.from(inputs).some(input => {
            const defaultValue = input.defaultValue || '';
            const currentValue = input.value || '';
            return defaultValue !== currentValue;
        });
    }

    focusSearchInput() {
        const searchInput = document.querySelector('input[type="search"], .search-input');
        if (searchInput) {
            searchInput.focus();
        }
    }

    openQuickActions() {
        const quickActionsModal = document.getElementById('quickActionsModal');
        if (quickActionsModal) {
            quickActionsModal.style.display = 'flex';
        }
    }

    closeModalsAndDropdowns() {
        // Close all modals
        const modals = document.querySelectorAll('.modal[style*="flex"]');
        modals.forEach(modal => {
            modal.style.display = 'none';
        });
        
        // Close all dropdowns
        const dropdowns = document.querySelectorAll('.dropdown.show, .user-dropdown.show');
        dropdowns.forEach(dropdown => {
            dropdown.classList.remove('show');
        });
        
        document.body.style.overflow = 'auto';
    }

    updateResponsiveElements() {
        // Update any elements that need responsive calculations
        const responsiveElements = document.querySelectorAll('[data-responsive]');
        
        responsiveElements.forEach(element => {
            const breakpoint = element.dataset.responsive;
            const shouldHide = window.innerWidth < parseInt(breakpoint);
            element.style.display = shouldHide ? 'none' : '';
        });
    }

    /**
     * Toast Notifications
     */
    showToast(message, type = 'info', duration = 5000) {
        // Remove existing toasts of the same type
        this.toasts.forEach(toast => {
            if (toast.type === type) {
                toast.element.remove();
            }
        });

        const toast = this.createToast(message, type);
        this.toasts.push({ element: toast, type });
        
        document.body.appendChild(toast);
        
        // Show animation
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Auto remove
        setTimeout(() => {
            this.removeToast(toast);
        }, duration);
        
        return toast;
    }

    createToast(message, type) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '<path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/>',
            error: '<path d="M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>',
            warning: '<path d="M13,14H11V10H13M13,18H11V16H13M1,21H23L12,2L1,21Z"/>',
            info: '<path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>'
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
        
        return toast;
    }

    removeToast(toast) {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
            this.toasts = this.toasts.filter(t => t.element !== toast);
        }, 300);
    }

    /**
     * Loading States
     */
    showLoading(message = 'Loading...') {
        this.isLoading = true;
        
        let overlay = document.getElementById('globalLoadingOverlay');
        if (!overlay) {
            overlay = this.createLoadingOverlay();
        }
        
        const text = overlay.querySelector('p');
        if (text) text.textContent = message;
        
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    hideLoading() {
        this.isLoading = false;
        
        const overlay = document.getElementById('globalLoadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }

    createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'globalLoadingOverlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
        
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Smooth scrolling
     */
    smoothScrollTo(target, duration = 1000) {
        const targetElement = typeof target === 'string' ? document.querySelector(target) : target;
        if (!targetElement) return;

        const targetPosition = targetElement.offsetTop - 80; // Account for navbar
        const startPosition = window.pageYOffset;
        const distance = targetPosition - startPosition;
        let startTime = null;

        const animation = (currentTime) => {
            if (startTime === null) startTime = currentTime;
            const timeElapsed = currentTime - startTime;
            const run = this.easeInOutQuad(timeElapsed, startPosition, distance, duration);
            
            window.scrollTo(0, run);
            
            if (timeElapsed < duration) {
                requestAnimationFrame(animation);
            }
        };

        requestAnimationFrame(animation);
    }

    easeInOutQuad(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }

    /**
     * Local Storage Helper
     */
    setLocalStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('LocalStorage error:', error);
            return false;
        }
    }

    getLocalStorage(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('LocalStorage error:', error);
            return defaultValue;
        }
    }

    removeLocalStorage(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('LocalStorage error:', error);
            return false;
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        // Remove event listeners
        window.removeEventListener('scroll', this.handleScroll);
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        document.removeEventListener('keydown', this.handleGlobalShortcuts);
        window.removeEventListener('error', this.handleGlobalError);
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);

        // Clear intervals and timeouts
        this.animations.forEach(animation => {
            if (animation.interval) clearInterval(animation.interval);
            if (animation.timeout) clearTimeout(animation.timeout);
        });

        // Remove toasts
        this.toasts.forEach(toast => toast.element.remove());
    }
}

// Initialize site controller
const siteController = new SiteController();

// Global helper functions
window.showToast = function(message, type = 'info', duration = 5000) {
    return siteController.showToast(message, type, duration);
};

window.showLoading = function(message = 'Loading...') {
    siteController.showLoading(message);
};

window.hideLoading = function() {
    siteController.hideLoading();
};

window.smoothScrollTo = function(target, duration = 1000) {
    siteController.smoothScrollTo(target, duration);
};

// Smooth scrolling for anchor links
document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href^="#"]');
    if (link) {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
            siteController.smoothScrollTo(target);
        }
    }
});

// Export for external use
window.SiteController = SiteController;
window.siteController = siteController;

console.log('✅ Main site functionality loaded');