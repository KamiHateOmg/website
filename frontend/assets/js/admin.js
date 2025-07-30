// CS2 Loader - Admin Panel Functionality
// Handles admin operations, user management, and system administration

/**
 * Admin Panel Manager
 * Main controller for admin dashboard functionality
 */
class AdminManager {
    constructor() {
        this.currentSection = 'overview';
        this.stats = {};
        this.users = [];
        this.keys = [];
        this.subscriptions = [];
        this.products = [];
        this.auditLogs = [];
        this.isLoading = false;
        this.refreshInterval = null;
        this.filters = {
            users: { page: 1, limit: 25, search: '', role: 'all', status: 'all' },
            keys: { page: 1, limit: 25, search: '', status: 'all', product: 'all' },
            subscriptions: { page: 1, limit: 25, search: '', status: 'all' },
            auditLogs: { page: 1, limit: 50, action: 'all', user: '' }
        };
        
        this.init();
    }

    /**
     * Initialize admin panel
     */
    async init() {
        // Check admin authentication
        if (!this.checkAdminAuth()) {
            window.location.href = 'login.html';
            return;
        }

        this.setupEventListeners();
        this.setupDataTables();
        await this.loadDashboardData();
        this.startAutoRefresh();
        this.updateNavigation();
    }

    /**
     * Check admin authentication
     */
    checkAdminAuth() {
        return authManager.isAuthenticated() && authManager.isAdmin();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Section navigation
        this.setupSectionNavigation();
        
        // Search and filter handlers
        this.setupSearchAndFilters();
        
        // Form handlers
        this.setupFormHandlers();
        
        // Modal handlers
        this.setupModalHandlers();
        
        // Bulk action handlers
        this.setupBulkActions();
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
        
        // Real-time updates
        this.setupRealTimeUpdates();
    }

    /**
     * Setup section navigation
     */
    setupSectionNavigation() {
        const navLinks = document.querySelectorAll('.admin-nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                if (section) {
                    this.showSection(section);
                }
            });
        });
    }

    /**
     * Setup search and filters
     */
    setupSearchAndFilters() {
        // Search inputs
        document.addEventListener('input', (e) => {
            if (e.target.matches('.search-input')) {
                this.debounce(() => {
                    this.handleSearch(e.target);
                }, 300)();
            }
        });

        // Filter selects
        document.addEventListener('change', (e) => {
            if (e.target.matches('.filter-select')) {
                this.handleFilterChange(e.target);
            }
        });

        // Date range pickers
        this.setupDateRangePickers();
    }

    /**
     * Setup form handlers
     */
    setupFormHandlers() {
        // User forms
        const userForm = document.getElementById('userForm');
        if (userForm) {
            userForm.addEventListener('submit', this.handleUserFormSubmit.bind(this));
        }

        // Product forms
        const productForm = document.getElementById('productForm');
        if (productForm) {
            productForm.addEventListener('submit', this.handleProductFormSubmit.bind(this));
        }

        // Key generation form
        const keyGenForm = document.getElementById('keyGenerationForm');
        if (keyGenForm) {
            keyGenForm.addEventListener('submit', this.handleKeyGeneration.bind(this));
        }

        // Bulk action forms
        const bulkActionForm = document.getElementById('bulkActionForm');
        if (bulkActionForm) {
            bulkActionForm.addEventListener('submit', this.handleBulkAction.bind(this));
        }
    }

    /**
     * Setup modal handlers
     */
    setupModalHandlers() {
        // Close modals on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // Close modals on overlay click
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeAllModals();
            }
        });
    }

    /**
     * Setup bulk actions
     */
    setupBulkActions() {
        // Select all checkbox
        const selectAllCheckbox = document.getElementById('selectAll');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', this.handleSelectAll.bind(this));
        }

        // Individual checkboxes
        document.addEventListener('change', (e) => {
            if (e.target.matches('.row-checkbox')) {
                this.updateBulkActions();
            }
        });
    }

    /**
     * Setup data tables
     */
    setupDataTables() {
        // Initialize sortable headers
        document.addEventListener('click', (e) => {
            if (e.target.matches('.sortable-header')) {
                this.handleSort(e.target);
            }
        });

        // Pagination handlers
        document.addEventListener('click', (e) => {
            if (e.target.matches('.pagination-btn')) {
                this.handlePagination(e.target);
            }
        });
    }

    /**
     * Setup real-time updates
     */
    setupRealTimeUpdates() {
        // Periodic data refresh
        this.startAutoRefresh();
        
        // WebSocket connection (if available)
        this.setupWebSocket();
    }

    /**
     * Load dashboard data
     */
    async loadDashboardData() {
        try {
            this.showLoading('Loading admin data...');
            
            await Promise.all([
                this.loadStats(),
                this.loadUsers(),
                this.loadKeys(),
                this.loadSubscriptions(),
                this.loadProducts(),
                this.loadAuditLogs()
            ]);
            
        } catch (error) {
            console.error('Error loading admin data:', error);
            this.showError('Failed to load admin data');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Load statistics
     */
    async loadStats() {
        try {
            const response = await adminAPI.getStats();
            this.stats = response.data;
            this.updateStatsDisplay();
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    /**
     * Load users
     */
    async loadUsers() {
        try {
            const response = await adminAPI.getUsers(this.filters.users);
            this.users = response.data.users || [];
            this.updateUsersDisplay();
            this.updatePagination('users', response.data.pagination);
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    /**
     * Load keys
     */
    async loadKeys() {
        try {
            const response = await adminAPI.getKeys(this.filters.keys);
            this.keys = response.data.keys || [];
            this.updateKeysDisplay();
            this.updatePagination('keys', response.data.pagination);
        } catch (error) {
            console.error('Error loading keys:', error);
        }
    }

    /**
     * Load subscriptions
     */
    async loadSubscriptions() {
        try {
            const response = await adminAPI.getSubscriptions(this.filters.subscriptions);
            this.subscriptions = response.data.subscriptions || [];
            this.updateSubscriptionsDisplay();
            this.updatePagination('subscriptions', response.data.pagination);
        } catch (error) {
            console.error('Error loading subscriptions:', error);
        }
    }

    /**
     * Load products
     */
    async loadProducts() {
        try {
            const response = await adminAPI.getProducts();
            this.products = response.data.products || [];
            this.updateProductsDisplay();
        } catch (error) {
            console.error('Error loading products:', error);
        }
    }

    /**
     * Load audit logs
     */
    async loadAuditLogs() {
        try {
            const response = await adminAPI.getAuditLogs(this.filters.auditLogs);
            this.auditLogs = response.data.logs || [];
            this.updateAuditLogsDisplay();
            this.updatePagination('auditLogs', response.data.pagination);
        } catch (error) {
            console.error('Error loading audit logs:', error);
        }
    }

    /**
     * Update stats display
     */
    updateStatsDisplay() {
        const statsCards = {
            'totalUsers': this.stats.totalUsers || 0,
            'activeSubscriptions': this.stats.activeSubscriptions || 0,
            'totalKeys': this.stats.totalKeys || 0,
            'monthlyRevenue': this.formatCurrency(this.stats.monthlyRevenue || 0)
        };

        Object.entries(statsCards).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                if (typeof value === 'number' && value > 999) {
                    element.textContent = this.formatNumber(value);
                } else {
                    element.textContent = value;
                }
            }
        });

        // Update charts
        this.updateCharts();
    }

    /**
     * Update users display
     */
    updateUsersDisplay() {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        if (this.users.length === 0) {
            tbody.innerHTML = this.getEmptyTableRow('No users found', 8);
            return;
        }

        tbody.innerHTML = this.users.map(user => `
            <tr class="table-row ${!user.isActive ? 'inactive' : ''}">
                <td>
                    <input type="checkbox" class="row-checkbox" data-id="${user.id}">
                </td>
                <td>
                    <div class="user-info">
                        <div class="user-avatar">${user.email.charAt(0).toUpperCase()}</div>
                        <div class="user-details">
                            <div class="user-name">${this.escapeHtml(user.email)}</div>
                            <div class="user-id">ID: ${user.id}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="role-badge role-${user.role}">${user.role}</span>
                </td>
                <td>
                    <span class="status-badge ${user.isActive ? 'active' : 'inactive'}">
                        ${user.isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <span class="verification-badge ${user.emailVerified ? 'verified' : 'unverified'}">
                        ${user.emailVerified ? 'Verified' : 'Unverified'}
                    </span>
                </td>
                <td>${this.formatDate(user.lastLogin)}</td>
                <td>${this.formatDate(user.createdAt)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-small btn-outline" onclick="adminManager.editUser('${user.id}')">
                            Edit
                        </button>
                        <button class="btn btn-small btn-danger" onclick="adminManager.deleteUser('${user.id}')">
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Update keys display
     */
    updateKeysDisplay() {
        const tbody = document.getElementById('keysTableBody');
        if (!tbody) return;

        if (this.keys.length === 0) {
            tbody.innerHTML = this.getEmptyTableRow('No keys found', 7);
            return;
        }

        tbody.innerHTML = this.keys.map(key => `
            <tr class="table-row">
                <td>
                    <input type="checkbox" class="row-checkbox" data-id="${key.id}">
                </td>
                <td>
                    <code class="key-code">${key.keyCode}</code>
                    <button class="btn btn-small btn-ghost" onclick="adminManager.copyToClipboard('${key.keyCode}')">
                        Copy
                    </button>
                </td>
                <td>${this.escapeHtml(key.productName)}</td>
                <td>
                    <span class="status-badge ${key.status}">
                        ${this.capitalizeFirst(key.status)}
                    </span>
                </td>
                <td>${key.redeemedBy || 'N/A'}</td>
                <td>${this.formatDate(key.createdAt)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-small btn-outline" onclick="adminManager.viewKeyDetails('${key.id}')">
                            View
                        </button>
                        <button class="btn btn-small btn-danger" onclick="adminManager.revokeKey('${key.id}')">
                            Revoke
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Update subscriptions display
     */
    updateSubscriptionsDisplay() {
        const tbody = document.getElementById('subscriptionsTableBody');
        if (!tbody) return;

        if (this.subscriptions.length === 0) {
            tbody.innerHTML = this.getEmptyTableRow('No subscriptions found', 7);
            return;
        }

        tbody.innerHTML = this.subscriptions.map(sub => `
            <tr class="table-row">
                <td>
                    <input type="checkbox" class="row-checkbox" data-id="${sub.id}">
                </td>
                <td>${this.escapeHtml(sub.userEmail)}</td>
                <td>${this.escapeHtml(sub.productName)}</td>
                <td>
                    <span class="status-badge ${sub.isActive ? 'active' : 'inactive'}">
                        ${sub.isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>${this.formatDate(sub.startDate)}</td>
                <td>${this.formatDate(sub.expiresAt)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-small btn-outline" onclick="adminManager.viewSubscription('${sub.id}')">
                            View
                        </button>
                        <button class="btn btn-small btn-danger" onclick="adminManager.cancelSubscription('${sub.id}')">
                            Cancel
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Update products display
     */
    updateProductsDisplay() {
        const tbody = document.getElementById('productsTableBody');
        if (!tbody) return;

        if (this.products.length === 0) {
            tbody.innerHTML = this.getEmptyTableRow('No products found', 6);
            return;
        }

        tbody.innerHTML = this.products.map(product => `
            <tr class="table-row">
                <td>${this.escapeHtml(product.name)}</td>
                <td>${this.formatCurrency(product.price)}</td>
                <td>${product.durationDays === 999999 ? 'Lifetime' : product.durationDays + ' days'}</td>
                <td>
                    <span class="status-badge ${product.isActive ? 'active' : 'inactive'}">
                        ${product.isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>${this.formatDate(product.createdAt)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-small btn-outline" onclick="adminManager.editProduct('${product.id}')">
                            Edit
                        </button>
                        <button class="btn btn-small btn-danger" onclick="adminManager.deleteProduct('${product.id}')">
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Update audit logs display
     */
    updateAuditLogsDisplay() {
        const tbody = document.getElementById('auditLogsTableBody');
        if (!tbody) return;

        if (this.auditLogs.length === 0) {
            tbody.innerHTML = this.getEmptyTableRow('No audit logs found', 5);
            return;
        }

        tbody.innerHTML = this.auditLogs.map(log => `
            <tr class="table-row">
                <td>${this.formatDate(log.createdAt)}</td>
                <td>${this.escapeHtml(log.userEmail || 'System')}</td>
                <td>
                    <span class="action-badge action-${log.action.toLowerCase()}">
                        ${this.formatActionName(log.action)}
                    </span>
                </td>
                <td>${log.ipAddress || 'N/A'}</td>
                <td>
                    <button class="btn btn-small btn-ghost" onclick="adminManager.viewLogDetails('${log.id}')">
                        View Details
                    </button>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Update charts
     */
    updateCharts() {
        // User registration chart
        if (this.stats.userRegistrations) {
            this.renderUserRegistrationChart();
        }

        // Revenue chart
        if (this.stats.revenueData) {
            this.renderRevenueChart();
        }

        // Subscription status chart
        if (this.stats.subscriptionStats) {
            this.renderSubscriptionChart();
        }
    }

    /**
     * Show section
     */
    showSection(sectionName) {
        this.currentSection = sectionName;

        // Update navigation
        document.querySelectorAll('.admin-nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');

        // Update sections
        document.querySelectorAll('.admin-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${sectionName}-section`)?.classList.add('active');

        // Load section data if needed
        this.loadSectionData(sectionName);
    }

    /**
     * Load section-specific data
     */
    async loadSectionData(sectionName) {
        switch (sectionName) {
            case 'users':
                await this.loadUsers();
                break;
            case 'keys':
                await this.loadKeys();
                break;
            case 'subscriptions':
                await this.loadSubscriptions();
                break;
            case 'products':
                await this.loadProducts();
                break;
            case 'logs':
                await this.loadAuditLogs();
                break;
        }
    }

    /**
     * Handle search
     */
    handleSearch(input) {
        const section = input.dataset.section;
        const query = input.value.trim();
        
        if (this.filters[section]) {
            this.filters[section].search = query;
            this.filters[section].page = 1; // Reset to first page
            this.loadSectionData(section);
        }
    }

    /**
     * Handle filter change
     */
    handleFilterChange(select) {
        const section = select.dataset.section;
        const filterType = select.dataset.filter;
        const value = select.value;
        
        if (this.filters[section]) {
            this.filters[section][filterType] = value;
            this.filters[section].page = 1; // Reset to first page
            this.loadSectionData(section);
        }
    }

    /**
     * Handle sort
     */
    handleSort(header) {
        const column = header.dataset.column;
        const section = header.dataset.section;
        
        // Toggle sort direction
        const currentDirection = this.filters[section]?.sortDirection || 'asc';
        const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
        
        this.filters[section].sortBy = column;
        this.filters[section].sortDirection = newDirection;
        
        // Update UI
        document.querySelectorAll('.sortable-header').forEach(h => {
            h.classList.remove('sort-asc', 'sort-desc');
        });
        header.classList.add(`sort-${newDirection}`);
        
        this.loadSectionData(section);
    }

    /**
     * Handle pagination
     */
    handlePagination(button) {
        const section = button.dataset.section;
        const action = button.dataset.action;
        
        if (!this.filters[section]) return;
        
        switch (action) {
            case 'first':
                this.filters[section].page = 1;
                break;
            case 'prev':
                this.filters[section].page = Math.max(1, this.filters[section].page - 1);
                break;
            case 'next':
                this.filters[section].page = this.filters[section].page + 1;
                break;
            case 'last':
                const lastPage = parseInt(button.dataset.lastPage);
                this.filters[section].page = lastPage;
                break;
            default:
                const page = parseInt(action);
                if (!isNaN(page)) {
                    this.filters[section].page = page;
                }
        }
        
        this.loadSectionData(section);
    }

    /**
     * Handle select all
     */
    handleSelectAll(e) {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = e.target.checked;
        });
        this.updateBulkActions();
    }

    /**
     * Update bulk actions
     */
    updateBulkActions() {
        const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
        const bulkActionContainer = document.querySelector('.bulk-actions');
        
        if (bulkActionContainer) {
            if (selectedCheckboxes.length > 0) {
                bulkActionContainer.style.display = 'flex';
                const count = document.querySelector('.selected-count');
                if (count) count.textContent = selectedCheckboxes.length;
            } else {
                bulkActionContainer.style.display = 'none';
            }
        }
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboardShortcuts(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'f':
                    e.preventDefault();
                    this.focusSearch();
                    break;
                case 'n':
                    e.preventDefault();
                    this.showCreateModal();
                    break;
                case 'r':
                    e.preventDefault();
                    this.refreshCurrentSection();
                    break;
            }
        }
    }

    /**
     * CRUD Operations
     */
    async createUser(userData) {
        try {
            const response = await adminAPI.createUser(userData);
            this.showSuccess('User created successfully');
            await this.loadUsers();
            this.closeAllModals();
        } catch (error) {
            this.showError(error.message || 'Failed to create user');
        }
    }

    async editUser(userId) {
        try {
            const response = await adminAPI.getUser(userId);
            this.showUserModal(response.data);
        } catch (error) {
            this.showError('Failed to load user data');
        }
    }

    async updateUser(userId, userData) {
        try {
            await adminAPI.updateUser(userId, userData);
            this.showSuccess('User updated successfully');
            await this.loadUsers();
            this.closeAllModals();
        } catch (error) {
            this.showError(error.message || 'Failed to update user');
        }
    }

    async deleteUser(userId) {
        if (!confirm('Are you sure you want to delete this user?')) return;
        
        try {
            await adminAPI.deleteUser(userId);
            this.showSuccess('User deleted successfully');
            await this.loadUsers();
        } catch (error) {
            this.showError(error.message || 'Failed to delete user');
        }
    }

    async generateKeys(data) {
        try {
            this.showLoading('Generating keys...');
            const response = await adminAPI.createKeys(data);
            this.showSuccess(`Generated ${response.data.count} keys successfully`);
            await this.loadKeys();
            this.closeAllModals();
        } catch (error) {
            this.showError(error.message || 'Failed to generate keys');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Utility Functions
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    }

    formatNumber(number) {
        if (number >= 1000000) {
            return (number / 1000000).toFixed(1) + 'M';
        } else if (number >= 1000) {
            return (number / 1000).toFixed(1) + 'K';
        }
        return number.toString();
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getEmptyTableRow(message, colspan) {
        return `
            <tr>
                <td colspan="${colspan}" class="empty-row">
                    <div class="empty-state">
                        <p>${message}</p>
                    </div>
                </td>
            </tr>
        `;
    }

    formatActionName(action) {
        return action.replace(/_/g, ' ').toLowerCase()
            .replace(/\b\w/g, l => l.toUpperCase());
    }

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

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showSuccess('Copied to clipboard');
        } catch (error) {
            this.showError('Failed to copy to clipboard');
        }
    }

    /**
     * Modal Functions
     */
    showUserModal(user = null) {
        const modal = document.getElementById('userModal');
        if (modal) {
            if (user) {
                // Edit mode
                document.getElementById('userFormTitle').textContent = 'Edit User';
                document.getElementById('userEmail').value = user.email;
                document.getElementById('userRole').value = user.role;
                document.getElementById('userActive').checked = user.isActive;
                document.getElementById('userId').value = user.id;
            } else {
                // Create mode
                document.getElementById('userFormTitle').textContent = 'Create User';
                document.getElementById('userForm').reset();
                document.getElementById('userId').value = '';
            }
            modal.style.display = 'flex';
        }
    }

    closeAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.style.overflow = 'auto';
    }

    /**
     * Auto refresh
     */
    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.loadStats();
        }, 60000); // Refresh stats every minute
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * WebSocket setup
     */
    setupWebSocket() {
        // WebSocket implementation for real-time updates
        // This would connect to your WebSocket server
        if (window.WebSocket) {
            // Implementation depends on your WebSocket setup
        }
    }

    /**
     * UI Helper Functions
     */
    showLoading(message = 'Loading...') {
        this.isLoading = true;
        const overlay = document.getElementById('adminLoadingOverlay');
        if (overlay) {
            const text = overlay.querySelector('p');
            if (text) text.textContent = message;
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        this.isLoading = false;
        const overlay = document.getElementById('adminLoadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    showInfo(message) {
        this.showToast(message, 'info');
    }

    showToast(message, type = 'info') {
        // Use the global toast function
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }

    /**
     * Update navigation
     */
    updateNavigation() {
        const user = authManager.getUser();
        if (user) {
            const userName = document.getElementById('adminUserName');
            const userRole = document.getElementById('adminUserRole');
            
            if (userName) userName.textContent = user.email;
            if (userRole) userRole.textContent = user.role;
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopAutoRefresh();
        this.closeAllModals();
        
        // Remove event listeners
        document.removeEventListener('keydown', this.handleKeyboardShortcuts);
    }
}

// Global helper functions for admin panel
window.showAdminSection = function(sectionName) {
    if (window.adminManager) {
        window.adminManager.showSection(sectionName);
    }
};

window.refreshAdminData = function() {
    if (window.adminManager) {
        window.adminManager.loadDashboardData();
    }
};

// Initialize admin panel on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if on admin page
    if (document.querySelector('.admin-container')) {
        window.adminManager = new AdminManager();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (window.adminManager) {
        window.adminManager.destroy();
    }
});

console.log('✅ Admin panel functionality loaded');