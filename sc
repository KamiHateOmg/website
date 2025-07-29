#!/usr/bin/env python3
import os

def create_directory_structure():
    """Create the complete CS2 Loader project directory structure"""
    
    print("Creating CS2 Loader project structure...")
    
    # Define all directories to create
    directories = [
        "backend/config",
        "backend/controllers", 
        "backend/middleware",
        "backend/models",
        "backend/routes",
        "backend/utils",
        "backend/scripts",
        "frontend/assets/css",
        "frontend/assets/js", 
        "frontend/assets/images/backgrounds",
        "frontend/pages",
        "frontend/components",
        "desktop-app/api",
        "desktop-app/integration",
        "database",
        "docs"
    ]
    
    # Define all files to create
    files = [
        # Backend config files
        "backend/config/database.js",
        "backend/config/auth.js",
        
        # Backend controllers
        "backend/controllers/authController.js",
        "backend/controllers/userController.js", 
        "backend/controllers/productController.js",
        "backend/controllers/keyController.js",
        "backend/controllers/subscriptionController.js",
        "backend/controllers/adminController.js",
        
        # Backend middleware
        "backend/middleware/auth.js",
        "backend/middleware/roleCheck.js",
        "backend/middleware/rateLimiter.js",
        
        # Backend models
        "backend/models/User.js",
        "backend/models/Product.js",
        "backend/models/Key.js", 
        "backend/models/Subscription.js",
        "backend/models/AuditLog.js",
        
        # Backend routes
        "backend/routes/auth.js",
        "backend/routes/users.js",
        "backend/routes/products.js",
        "backend/routes/keys.js",
        "backend/routes/subscriptions.js",
        "backend/routes/admin.js",
        
        # Backend utils
        "backend/utils/keyGenerator.js",
        "backend/utils/hwidChecker.js",
        "backend/utils/emailService.js",
        "backend/utils/logger.js",
        
        # Backend scripts
        "backend/scripts/setup.js",
        "backend/scripts/createAdmin.js",
        
        # Backend main files
        "backend/app.js",
        "backend/server.js",
        "backend/package.json",
        
        # Frontend CSS files
        "frontend/assets/css/main.css",
        "frontend/assets/css/auth.css",
        "frontend/assets/css/dashboard.css",
        "frontend/assets/css/admin.css",
        
        # Frontend JS files
        "frontend/assets/js/main.js",
        "frontend/assets/js/auth.js",
        "frontend/assets/js/dashboard.js",
        "frontend/assets/js/products.js",
        "frontend/assets/js/admin.js",
        "frontend/assets/js/api.js",
        
        # Frontend images
        "frontend/assets/images/logo.png",
        
        # Frontend pages
        "frontend/pages/index.html",
        "frontend/pages/login.html",
        "frontend/pages/register.html",
        "frontend/pages/products.html",
        "frontend/pages/dashboard.html",
        "frontend/pages/admin.html",
        "frontend/pages/staff.html",
        
        # Frontend components
        "frontend/components/header.html",
        "frontend/components/footer.html",
        "frontend/components/modals.html",
        
        # Desktop app files
        "desktop-app/api/subscriptionChecker.cs",
        "desktop-app/integration/webApiClient.cs",
        
        # Database files
        "database/schema.sql",
        "database/triggers.sql",
        "database/seed.sql",
        
        # Documentation files
        "docs/API.md",
        "docs/SETUP.md",
        "docs/DEPLOYMENT.md",
        
        # Root configuration files
        ".env.example",
        ".gitignore",
        "README.md",
        "package.json"
    ]
    
    # Create directories
    print("Creating directories...")
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        print(f"Created directory: {directory}")
    
    # Create files
    print("\nCreating files...")
    for file_path in files:
        # Create directory if it doesn't exist
        directory = os.path.dirname(file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        
        # Create empty file
        with open(file_path, 'w') as f:
            pass  # Create empty file
        print(f"Created file: {file_path}")
    
    print("\n✅ CS2 Loader project structure created successfully!")
    print("\n📁 Directory structure:")
    print("├── backend/           (Node.js API server)")
    print("├── frontend/          (Web interface)")
    print("├── desktop-app/       (C# desktop app)")
    print("├── database/          (SQL files)")
    print("├── docs/              (Documentation)")
    print("└── configuration files")
    print("\n🚀 All files created as empty files ready for development!")

if __name__ == "__main__":
    create_directory_structure()