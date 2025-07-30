// CS2 Loader - Dashboard Functionality
// Handles dashboard operations, user management, and subscription controls

/**
 * Dashboard Manager Class
 * Main dashboard controller handling all user dashboard operations
 */
class DashboardManager {
    constructor() {
        this.currentSection = 'overview';
        this.userHwid = null;
        this.userInfo = null;
        this.subscriptionData = null;
        this.keysData = [];
        this.historyData = [];
        this.isLoading = false;
        this.refreshInterval = null;
        
        this.init();
    }

    /**
     * Initialize dashboard
     */
    async init() {
        // Check authentication
        if (!this.checkAuth()) {
            window.location.href = 'login.html';
            return;
        }

        this.setupEventListeners();
        this.setupNavigation();
        await this.loadUserData();
        await this.generateHwid();
        this.startAutoRefresh();
        this.updateNavigation();
    }

    /**
     * Check if user is authenticated
     */
    checkAuth() {
        return authManager.isAuthenticated();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Key input formatting
        const keyInput = document.getElementById('keyCode');
        if (keyInput) {
            keyInput.addEventListener('input', this.formatKeyInput.bind(this));
            keyInput.addEventListener('paste', this.handleKeyPaste.bind(this));
        }

        // Forms
        this.setupFormHandlers();

        // Modal events
        this.setupModalHandlers();

        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));

        // Window events
        window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
        window.addEventListener('focus', this.handleWindowFocus.bind(this));
    }

    /**
     * Setup form handlers
     */
    setupFormHandlers() {
        const redeemForm = document.getElementById('redeemForm');
        if (redeemForm) {
            redeemForm.addEventListener('submit', this.handleKeyRedemption.bind(this));
        }

        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', this.handleProfileUpdate.bind(this));
        }

        // Delete confirmation input
        const deleteInput = document.getElementById('deleteConfirmation');
        if (deleteInput) {
            deleteInput.addEventListener('input', (e) => {
                const confirmBtn = document.getElementById('confirmDeleteBtn');
                if (confirmBtn) {
                    confirmBtn.disabled = e.target.value !== 'DELETE';
                }
            });
        }

        // History filters
        const historyFilter = document.getElementById('historyFilter');
        const timeFilter = document.getElementById('timeFilter');
        if (historyFilter) {
            historyFilter.addEventListener('change', () => this.loadHistory());
        }
        if (timeFilter) {
            timeFilter.addEventListener('change', () => this.loadHistory());
        }
    }

    /**
     * Setup modal handlers
     */
    setupModalHandlers() {
        // Close modals with escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // Close modals when clicking overlay
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeAllModals();
            }
        });
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboardShortcuts(e) {
        // Ctrl/Cmd + R for refresh
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            this.refreshDashboard();
        }

        // Ctrl/Cmd + K for key redemption
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            this.showSection('redeem');
        }
    }

    /**
     * Handle before unload
     */
    handleBeforeUnload(e) {
        // Warn if there are unsaved changes
        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            if (this.hasUnsavedChanges(form)) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        }
    }

    /**
     * Handle window focus
     */
    handleWindowFocus() {
        // Refresh data when window gains focus
        if (this.isAuthenticated()) {
            this.loadSubscription();
        }
    }

    /**
     * Setup navigation
     */
    setupNavigation() {
        const sidebarLinks = document.querySelectorAll('.sidebar-link');
        sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.getAttribute('onclick')?.match(/showSection\('(.+)'\)/)?.[1];
                if (section) {
                    this.showSection(section);
                }
            });
        });
    }

    /**
     * Update navigation UI
     */
    updateNavigation() {
        const user = authManager.getUser();
        if (user) {
            const userName = document.getElementById('userName');
            const userRole = document.getElementById('userRole');
            const userInitials = document.getElementById('userInitials');

            if (userName) userName.textContent = user.email;
            if (userRole) userRole.textContent = user.role || 'user';
            if (userInitials) {
                userInitials.textContent = user.email.charAt(0).toUpperCase();
            }
        }
    }

    /**
     * Load all user data
     */
    async loadUserData() {
        try {
            this.showLoading('Loading dashboard...');
            
            await Promise.all([
                this.loadProfile(),
                this.loadSubscription(),
                this.loadKeys(),
                this.loadHistory()
            ]);
            
        } catch (error) {
            console.error('Error loading user data:', error);
            this.showError('Failed to load dashboard data');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Load user profile
     */
    async loadProfile() {
        try {
            const response = await userAPI.getProfile();
            this.userInfo = response.data;
            this.updateProfileForm();
        } catch (error) {
            console.error('Error loading profile:', error);
        }
    }

    /**
     * Load subscription data
     */
    async loadSubscription() {
        try {
            const response = await userAPI.getSubscription();
            this.subscriptionData = response.data;
        } catch (error) {
            console.error('Error loading subscription:', error);
            this.subscriptionData = null;
        }
        
        this.updateSubscriptionDisplay();
        this.updateQuickStats();
    }

    /**
     * Load user keys
     */
    async loadKeys() {
        try {
            const response = await userAPI.getKeys();
            this.keysData = response.data.keys || [];
        } catch (error) {
            console.error('Error loading keys:', error);
            this.keysData = [];
        }
        
        this.updateKeysDisplay();
    }

    /**
     * Load user history
     */
    async loadHistory() {
        try {
            const historyFilter = document.getElementById('historyFilter')?.value || 'all';
            const timeFilter = document.getElementById('timeFilter')?.value || 'all';
            
            const params = {};
            if (historyFilter !== 'all') params.type = historyFilter;
            if (timeFilter !== 'all') params.days = timeFilter;

            const response = await userAPI.getHistory(params);
            this.historyData = response.data.history || [];
        } catch (error) {
            console.error('Error loading history:', error);
            this.historyData = [];
        }
        
        this.updateHistoryDisplay();
    }

    /**
     * Update profile form
     */
    updateProfileForm() {
        if (!this.userInfo) return;

        const elements = {
            'profileEmail': this.userInfo.email || '',
            'accountRole': this.userInfo.role || '',
            'memberSince': this.formatDate(this.userInfo.createdAt),
            'lastLogin': this.formatDate(this.userInfo.lastLogin)
        };

        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
    }

    /**
     * Update subscription display
     */
    updateSubscriptionDisplay() {
        const statusElement = document.getElementById('subscriptionStatus');
        const detailsElement = document.getElementById('subscriptionDetails');

        if (this.subscriptionData && this.subscriptionData.isActive) {
            const sub = this.subscriptionData;
            const timeLeft = this.calculateTimeLeft(sub.expiresAt);
            
            if (statusElement) {
                statusElement.innerHTML = this.getActiveSubscriptionHTML(sub, timeLeft);
            }

            if (detailsElement) {
                detailsElement.innerHTML = this.getSubscriptionDetailsHTML(sub, timeLeft);
            }
        } else {
            if (statusElement) {
                statusElement.innerHTML = this.getInactiveSubscriptionHTML();
            }

            if (detailsElement) {
                detailsElement.innerHTML = this.getNoSubscriptionHTML();
            }
        }
    }

    /**
     * Get active subscription HTML
     */
    getActiveSubscriptionHTML(sub, timeLeft) {
        return `
            <div class="subscription-active">
                <div class="sub-status">
                    <span class="status-badge active">Active</span>
                    <span class="sub-product">${sub.productName}</span>
                </div>
                <div class="sub-time">
                    <span class="time-value">${timeLeft.display}</span>
                    <span class="time-label">remaining</span>
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${timeLeft.percentage}%"></div>
            </div>
        `;
    }

    /**
     * Get subscription details HTML
     */
    getSubscriptionDetailsHTML(sub, timeLeft) {
        return `
            <div class="subscription-card active">
                <div class="sub-header">
                    <div class="sub-icon active">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/>
                        </svg>
                    </div>
                    <div class="sub-info">
                        <h3>${sub.productName}</h3>
                        <p class="sub-status-text">Active Subscription</p>
                    </div>
                    <div class="sub-badge">
                        <span class="badge active">Active</span>
                    </div>
                </div>
                <div class="sub-details">
                    <div class="detail-row">
                        <span class="detail-label">Expires:</span>
                        <span class="detail-value">${this.formatDate(sub.expiresAt)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Time Remaining:</span>
                        <span class="detail-value">${timeLeft.display}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Hardware ID:</span>
                        <span class="detail-value">${sub.hwid}</span>
                    </div>
                </div>
                <div class="sub-actions">
                    <button class="btn btn-outline btn-small" onclick="window.open('products.html', '_blank')">
                        Extend Subscription
                    </button>
                    <button class="btn btn-primary btn-small" onclick="downloadLoader()">
                        Download Loader
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Get inactive subscription HTML
     */
    getInactiveSubscriptionHTML() {
        return `
            <div class="subscription-inactive">
                <div class="sub-status">
                    <span class="status-badge inactive">Inactive</span>
                    <span class="sub-product">No Active Subscription</span>
                </div>
                <button class="btn btn-primary btn-small" onclick="dashboardManager.showSection('redeem')">
                    Redeem Key
                </button>
            </div>
        `;
    }

    /**
     * Get no subscription HTML
     */
    getNoSubscriptionHTML() {
        return `
            <div class="subscription-card inactive">
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M12,7C13.4,7 14.8,8.6 14.8,10V11.5C15.4,11.5 16,12.1 16,12.7V16.2C16,16.8 15.4,17.3 14.8,17.3H9.2C8.6,17.3 8,16.8 8,16.2V12.8C8,12.2 8.6,11.7 9.2,11.7V10C9.2,8.6 10.6,7 12,7M12,8.2C11.2,8.2 10.5,8.7 10.5,9.5V11.5H13.5V9.5C13.5,8.7 12.8,8.2 12,8.2Z"/>
                        </svg>
                    </div>
                    <h3>No Active Subscription</h3>
                    <p>You don't have an active CS2 Loader subscription. Redeem a key or purchase a new subscription to get started.</p>
                    <div class="empty-actions">
                        <button class="btn btn-primary" onclick="dashboardManager.showSection('redeem')">Redeem Key</button>
                        <button class="btn btn-outline" onclick="window.open('products.html', '_blank')">Buy Subscription</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Update keys display
     */
    updateKeysDisplay() {
        const keysStatusElement = document.getElementById('keysStatus');
        const keysListElement = document.getElementById('keysList');

        const unredeemedKeys = this.keysData.filter(key => !key.isRedeemed && !key.isExpired);
        
        if (keysStatusElement) {
            keysStatusElement.innerHTML = `
                <div class="keys-info">
                    <span class="keys-count">${unredeemedKeys.length}</span>
                    <span class="keys-label">${unredeemedKeys.length === 1 ? 'key' : 'keys'} available</span>
                </div>
                ${unredeemedKeys.length > 0 ? 
                    '<button class="btn btn-primary btn-small" onclick="dashboardManager.showSection(\'redeem\')">Redeem Key</button>' : 
                    '<button class="btn btn-outline btn-small" onclick="window.open(\'products.html\', \'_blank\')">Buy Keys</button>'
                }
            `;
        }

        if (keysListElement) {
            if (this.keysData.length === 0) {
                keysListElement.innerHTML = this.getEmptyKeysHTML();
            } else {
                keysListElement.innerHTML = this.keysData.map(key => this.renderKeyItem(key)).join('');
            }
        }
    }

    /**
     * Get empty keys HTML
     */
    getEmptyKeysHTML() {
        return `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7,14A3,3 0 0,0 10,17A3,3 0 0,0 13,14A3,3 0 0,0 10,11A3,3 0 0,0 7,14M12.65,10C11.83,7.67 9.61,6 7,6A6,6 0 0,0 1,12A6,6 0 0,0 7,18C9.61,18 11.83,16.33 12.65,14H17V18H21V14H23V10H12.65Z"/>
                    </svg>
                </div>
                <h3>No Keys Found</h3>
                <p>You haven't purchased any keys yet.</p>
                <button class="btn btn-primary" onclick="window.open('products.html', '_blank')">
                    Purchase Keys
                </button>
            </div>
        `;
    }

    /**
     * Render individual key item
     */
    renderKeyItem(key) {
        const statusClass = key.isRedeemed ? 'redeemed' : key.isExpired ? 'expired' : 'available';
        const statusText = key.isRedeemed ? 'Redeemed' : key.isExpired ? 'Expired' : 'Available';
        
        return `
            <div class="key-item ${statusClass}">
                <div class="key-header">
                    <div class="key-code">${key.keyCode}</div>
                    <div class="key-status ${statusClass}">${statusText}</div>
                </div>
                <div class="key-details">
                    <div class="key-info">
                        <span class="key-product">${key.productName}</span>
                        <span class="key-duration">${key.durationDays === 999999 ? 'Lifetime' : key.durationDays + ' days'}</span>
                    </div>
                    <div class="key-dates">
                        <span class="key-date">Purchased: ${this.formatDate(key.createdAt)}</span>
                        ${key.redeemedAt ? `<span class="key-date">Redeemed: ${this.formatDate(key.redeemedAt)}</span>` : ''}
                        ${key.expiresAt ? `<span class="key-date">Expires: ${this.formatDate(key.expiresAt)}</span>` : ''}
                    </div>
                </div>
                <div class="key-actions">
                    ${!key.isRedeemed && !key.isExpired ? 
                        `<button class="btn btn-primary btn-small" onclick="dashboardManager.fillKeyInput('${key.keyCode}')">Redeem</button>` : 
                        ''
                    }
                    <button class="btn btn-outline btn-small" onclick="dashboardManager.copyToClipboard('${key.keyCode}')">Copy</button>
                </div>
            </div>
        `;
    }

    /**
     * Update history display
     */
    updateHistoryDisplay() {
        const historyListElement = document.getElementById('historyList');
        
        if (!historyListElement) return;

        if (this.historyData.length === 0) {
            historyListElement.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3"/>
                        </svg>
                    </div>
                    <h3>No History Found</h3>
                    <p>No transactions match your current filter.</p>
                </div>
            `;
        } else {
            historyListElement.innerHTML = this.historyData.map(item => this.renderHistoryItem(item)).join('');
        }
    }

    /**
     * Render history item
     */
    renderHistoryItem(item) {
        const typeIcons = {
            purchase: '<path d="M19,7H22V9H19V12H17V9H14V7H17V4H19V7M12,2A3,3 0 0,1 15,5V6H19A2,2 0 0,1 21,8V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V8A2,2 0 0,1 5,6H9V5A3,3 0 0,1 12,2M12,4A1,1 0 0,0 11,5V6H13V5A1,1 0 0,0 12,4Z"/>',
            redemption: '<path d="M7,14A3,3 0 0,0 10,17A3,3 0 0,0 13,14A3,3 0 0,0 10,11A3,3 0 0,0 7,14M12.65,10C11.83,7.67 9.61,6 7,6A6,6 0 0,0 1,12A6,6 0 0,0 7,18C9.61,18 11.83,16.33 12.65,14H17V18H21V14H23V10H12.65Z"/>',
            subscription: '<path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/>'
        };

        return `
            <div class="history-item">
                <div class="history-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        ${typeIcons[item.type] || typeIcons.purchase}
                    </svg>
                </div>
                <div class="history-content">
                    <div class="history-title">${item.description}</div>
                    <div class="history-details">
                        <span class="history-date">${this.formatDate(item.createdAt)}</span>
                        ${item.amount ? `<span class="history-amount">${item.amount}</span>` : ''}
                    </div>
                </div>
                <div class="history-status">
                    <span class="status-badge ${item.status}">${item.status}</span>
                </div>
            </div>
        `;
    }

    /**
     * Update quick stats
     */
    updateQuickStats() {
        const statusElement = document.getElementById('quickStatus');
        const timeLeftElement = document.getElementById('quickTimeLeft');

        if (this.subscriptionData && this.subscriptionData.isActive) {
            const timeLeft = this.calculateTimeLeft(this.subscriptionData.expiresAt);
            if (statusElement) statusElement.textContent = 'Active';
            if (timeLeftElement) timeLeftElement.textContent = timeLeft.display;
        } else {
            if (statusElement) statusElement.textContent = 'Inactive';
            if (timeLeftElement) timeLeftElement.textContent = '--';
        }
    }

    /**
     * Generate hardware ID
     */
    async generateHwid() {
        try {
            this.userHwid = await generateHWID();
            
            const hwidElement = document.getElementById('deviceHwid');
            if (hwidElement) {
                hwidElement.textContent = this.userHwid;
            }
        } catch (error) {
            console.error('HWID generation error:', error);
            this.userHwid = 'HWID-' + Date.now().toString(36).toUpperCase();
        }
    }

    /**
     * Handle key redemption
     */
    async handleKeyRedemption(e) {
        e.preventDefault();
        
        const keyCode = document.getElementById('keyCode')?.value.trim();
        if (!this.validateKeyFormat(keyCode)) {
            this.showFieldError('keyCodeError', 'Please enter a valid key in the format XXXX-XXXX-XXXX-XXXX');
            return;
        }

        try {
            this.setLoading(true, 'Redeeming key...');
            
            const response = await keysAPI.redeemKey(keyCode, this.userHwid);

            if (response.data) {
                this.showRedeemSuccess(response.data);
                document.getElementById('redeemForm')?.reset();
                this.clearError('keyCodeError');
                
                // Reload data
                await this.loadSubscription();
                await this.loadKeys();
            }
        } catch (error) {
            this.showFieldError('keyCodeError', error.message || 'Key redemption failed');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Handle profile update
     */
    async handleProfileUpdate(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const updateData = {};
        
        // Only include fields that can be updated
        const updatableFields = ['displayName', 'notifications'];
        updatableFields.forEach(field => {
            if (formData.has(field)) {
                updateData[field] = formData.get(field);
            }
        });

        try {
            this.setLoading(true, 'Updating profile...');
            
            const response = await userAPI.updateProfile(updateData);
            this.userInfo = response.data;
            this.updateProfileForm();
            this.showSuccess('Profile updated successfully');
        } catch (error) {
            this.showError(error.message || 'Failed to update profile');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Show redemption success modal
     */
    showRedeemSuccess(data) {
        const modal = document.getElementById('redeemSuccessModal');
        const detailsElement = document.getElementById('redemptionDetails');
        
        if (detailsElement) {
            detailsElement.innerHTML = `
                <div class="redemption-info">
                    <div class="redemption-row">
                        <span class="redemption-label">Product:</span>
                        <span class="redemption-value">${data.subscription.productName}</span>
                    </div>
                    <div class="redemption-row">
                        <span class="redemption-label">Duration:</span>
                        <span class="redemption-value">${data.subscription.isLifetime ? 'Lifetime' : data.subscription.durationDays + ' days'}</span>
                    </div>
                    <div class="redemption-row">
                        <span class="redemption-label">Expires:</span>
                        <span class="redemption-value">${this.formatDate(data.subscription.expiresAt)}</span>
                    </div>
                    <div class="redemption-row">
                        <span class="redemption-label">Hardware ID:</span>
                        <span class="redemption-value">${this.userHwid}</span>
                    </div>
                </div>
            `;
        }
        
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Show section
     */
    showSection(sectionName) {
        this.currentSection = sectionName;
        
        // Update sidebar
        document.querySelectorAll('.sidebar-link').forEach(link => {
            link.classList.remove('active');
        });
        
        const activeLink = document.querySelector(`[onclick*="'${sectionName}'"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
        
        // Update sections
        document.querySelectorAll('.dashboard-section').forEach(section => {
            section.classList.remove('active');
        });
        
        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // Update URL without navigation
        const url = new URL(window.location);
        url.searchParams.set('section', sectionName);
        window.history.replaceState({}, '', url);
    }

    /**
     * Fill key input with provided key
     */
    fillKeyInput(keyCode) {
        const keyInput = document.getElementById('keyCode');
        if (keyInput) {
            keyInput.value = keyCode;
            this.showSection('redeem');
            keyInput.focus();
        }
    }

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showSuccess('Copied to clipboard!');
        } catch (error) {
            console.error('Failed to copy:', error);
            this.showError('Failed to copy to clipboard');
        }
    }

    /**
     * Filter keys
     */
    filterKeys(filter) {
        // Update filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = document.querySelector(`[data-filter="${filter}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
        
        // Filter key items
        const keyItems = document.querySelectorAll('.key-item');
        keyItems.forEach(item => {
            const show = filter === 'all' || item.classList.contains(filter);
            item.style.display = show ? 'block' : 'none';
        });
    }

    /**
     * Format key input
     */
    formatKeyInput(e) {
        let value = e.target.value.replace(/[^A-Z0-9]/g, '');
        let formatted = '';
        
        for (let i = 0; i < value.length; i++) {
            if (i > 0 && i % 4 === 0) {
                formatted += '-';
            }
            formatted += value[i];
        }
        
        e.target.value = formatted.substring(0, 19);
    }

    /**
     * Handle key paste
     */
    handleKeyPaste(e) {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text');
        const cleaned = paste.replace(/[^A-Z0-9]/g, '');
        
        if (cleaned.length === 16) {
            const formatted = cleaned.replace(/(.{4})/g, '$1-').slice(0, -1);
            e.target.value = formatted;
        }
    }

    /**
     * Validate key format
     */
    validateKeyFormat(key) {
        const pattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
        return pattern.test(key);
    }

    /**
     * Calculate time left
     */
    calculateTimeLeft(expiresAt) {
        const now = new Date();
        const expires = new Date(expiresAt);
        const diff = expires - now;
        
        if (diff <= 0) {
            return { display: 'Expired', percentage: 0 };
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        let display;
        if (days > 0) {
            display = `${days}d ${hours}h`;
        } else if (hours > 0) {
            display = `${hours}h ${minutes}m`;
        } else {
            display = `${minutes}m`;
        }
        
        // Calculate percentage (assuming 30 days max for progress bar)
        const maxDays = 30;
        const percentage = Math.min(100, (days / maxDays) * 100);
        
        return { display, percentage };
    }

    /**
     * Format date
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Start auto refresh
     */
    startAutoRefresh() {
        // Refresh subscription status every 5 minutes
        this.refreshInterval = setInterval(() => {
            if (this.isAuthenticated()) {
                this.loadSubscription();
            }
        }, 5 * 60 * 1000);
    }

    /**
     * Stop auto refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Refresh dashboard
     */
    async refreshDashboard() {
        await this.loadUserData();
        this.showSuccess('Dashboard refreshed');
    }

    /**
     * Close all modals
     */
    closeAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.style.overflow = 'auto';
    }

    /**
     * Check for unsaved changes
     */
    hasUnsavedChanges(form) {
        const inputs = form.querySelectorAll('input, textarea, select');
        return Array.from(inputs).some(input => {
            return input.defaultValue !== input.value;
        });
    }

    /**
     * UI Helper Functions
     */
    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            const text = overlay.querySelector('p');
            if (text) text.textContent = message;
            overlay.style.display = 'flex';
        }
        this.isLoading = true;
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
        this.isLoading = false;
    }

    setLoading(loading, message = 'Loading...') {
        if (loading) {
            this.showLoading(message);
        } else {
            this.hideLoading();
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

    showFieldError(fieldId, message) {
        const errorElement = document.getElementById(fieldId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    clearError(fieldId) {
        const errorElement = document.getElementById(fieldId);
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
        }
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
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, type === 'error' ? 6000 : 4000);
    }

    /**
     * Cleanup on destroy
     */
    destroy() {
        this.stopAutoRefresh();
        this.closeAllModals();
        
        // Remove event listeners
        document.removeEventListener('keydown', this.handleKeyboardShortcuts);
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        window.removeEventListener('focus', this.handleWindowFocus);
    }
}

// Global helper functions
window.showSection = function(sectionName) {
    if (window.dashboardManager) {
        window.dashboardManager.showSection(sectionName);
    }
};

window.filterKeys = function(filter) {
    if (window.dashboardManager) {
        window.dashboardManager.filterKeys(filter);
    }
};

window.downloadLoader = function() {
    // In a real implementation, this would trigger the actual download
    if (window.dashboardManager) {
        window.dashboardManager.showToast('Download started! Check your downloads folder.', 'success');
    }
};

window.pasteKey = async function() {
    try {
        const text = await navigator.clipboard.readText();
        const keyInput = document.getElementById('keyCode');
        if (keyInput) {
            keyInput.value = text.trim();
            keyInput.dispatchEvent(new Event('input'));
        }
    } catch (error) {
        console.error('Failed to paste:', error);
        if (window.dashboardManager) {
            window.dashboardManager.showError('Failed to paste from clipboard');
        }
    }
};

window.closeRedeemSuccessModal = function() {
    const modal = document.getElementById('redeemSuccessModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

window.showAccountSettings = function() {
    const modal = document.getElementById('accountSettingsModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};

window.closeAccountSettings = function() {
    const modal = document.getElementById('accountSettingsModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

window.showDeleteAccountModal = function() {
    const modal = document.getElementById('deleteAccountModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};

window.closeDeleteAccountModal = function() {
    const modal = document.getElementById('deleteAccountModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        
        // Reset form
        const input = document.getElementById('deleteConfirmation');
        const btn = document.getElementById('confirmDeleteBtn');
        if (input) input.value = '';
        if (btn) btn.disabled = true;
    }
};

window.confirmDeleteAccount = function() {
    const confirmation = document.getElementById('deleteConfirmation')?.value;
    if (confirmation === 'DELETE' && window.dashboardManager) {
        window.dashboardManager.showToast('Account deletion is not implemented in this demo', 'info');
        window.closeDeleteAccountModal();
    }
};

window.changePassword = function() {
    const currentPassword = document.getElementById('currentPassword')?.value;
    const newPassword = document.getElementById('newPassword')?.value;
    
    if (!currentPassword || !newPassword) {
        if (window.dashboardManager) {
            window.dashboardManager.showError('Please fill in both password fields');
        }
        return;
    }
    
    if (newPassword.length < 8) {
        if (window.dashboardManager) {
            window.dashboardManager.showError('New password must be at least 8 characters long');
        }
        return;
    }
    
    if (window.dashboardManager) {
        window.dashboardManager.showToast('Password change is not implemented in this demo', 'info');
    }
    
    // Clear fields
    const current = document.getElementById('currentPassword');
    const newPwd = document.getElementById('newPassword');
    if (current) current.value = '';
    if (newPwd) newPwd.value = '';
};

window.showTwoFactorSetup = function() {
    if (window.dashboardManager) {
        window.dashboardManager.showToast('Two-factor authentication setup coming soon!', 'info');
    }
};

// Initialize dashboard on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    window.dashboardManager = new DashboardManager();
    
    // Handle section from URL
    const urlParams = new URLSearchParams(window.location.search);
    const section = urlParams.get('section');
    if (section) {
        window.dashboardManager.showSection(section);
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (window.dashboardManager) {
        window.dashboardManager.destroy();
    }
});

console.log('✅ Dashboard functionality loaded');