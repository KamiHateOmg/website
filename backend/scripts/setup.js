const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

class DatabaseSetup {
    constructor() {
        this.pool = null;
        this.schemaPath = path.join(__dirname, '../database/schema.sql');
        this.triggersPath = path.join(__dirname, '../database/triggers.sql');
        this.seedPath = path.join(__dirname, '../database/seed.sql');
    }

    async connect() {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL environment variable is not set');
        }

        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        try {
            await this.pool.query('SELECT 1');
            console.log('✅ Connected to PostgreSQL database');
        } catch (error) {
            throw new Error(`Database connection failed: ${error.message}`);
        }
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            console.log('🔌 Disconnected from database');
        }
    }

    async checkDatabaseExists() {
        try {
            // Try to connect and run a simple query
            await this.pool.query('SELECT current_database()');
            return true;
        } catch (error) {
            return false;
        }
    }

    async checkTablesExist() {
        try {
            const result = await this.pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
            `);
            
            const tables = result.rows.map(row => row.table_name);
            const expectedTables = [
                'users', 'products', 'keys', 'subscriptions', 
                'purchases', 'audit_logs', 'login_attempts', 'api_keys'
            ];
            
            const missingTables = expectedTables.filter(table => !tables.includes(table));
            
            return {
                exists: missingTables.length === 0,
                existing: tables,
                missing: missingTables,
                total: tables.length
            };
        } catch (error) {
            return { exists: false, existing: [], missing: [], total: 0 };
        }
    }

    async runSQLFile(filePath, description) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`SQL file not found: ${filePath}`);
        }

        const sql = fs.readFileSync(filePath, 'utf8');
        console.log(`📄 Running ${description}...`);

        try {
            // Split by semicolon and execute each statement
            const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
            
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i].trim();
                if (statement) {
                    await this.pool.query(statement);
                }
            }
            
            console.log(`✅ ${description} completed successfully`);
        } catch (error) {
            console.error(`❌ Error in ${description}:`, error.message);
            throw error;
        }
    }

    async createSchema() {
        await this.runSQLFile(this.schemaPath, 'database schema creation');
    }

    async createTriggers() {
        if (fs.existsSync(this.triggersPath)) {
            await this.runSQLFile(this.triggersPath, 'database triggers setup');
        } else {
            console.log('ℹ️  No triggers file found, skipping...');
        }
    }

    async seedDatabase() {
        if (fs.existsSync(this.seedPath)) {
            const proceed = await question('Do you want to seed the database with sample data? (y/N): ');
            if (proceed.toLowerCase() === 'y' || proceed.toLowerCase() === 'yes') {
                await this.runSQLFile(this.seedPath, 'database seeding');
            } else {
                console.log('⏭️  Skipping database seeding');
            }
        } else {
            console.log('ℹ️  No seed file found, skipping...');
        }
    }

    async verifySetup() {
        console.log('\n🔍 Verifying database setup...');
        
        try {
            // Check tables
            const tableCheck = await this.checkTablesExist();
            if (tableCheck.exists) {
                console.log(`✅ All ${tableCheck.total} tables created successfully`);
            } else {
                console.log(`⚠️  ${tableCheck.missing.length} tables missing:`, tableCheck.missing);
            }

            // Check functions
            const functionResult = await this.pool.query(`
                SELECT routine_name 
                FROM information_schema.routines 
                WHERE routine_type = 'FUNCTION' 
                AND routine_schema = 'public'
                ORDER BY routine_name
            `);
            
            const functions = functionResult.rows.map(row => row.routine_name);
            console.log(`✅ ${functions.length} database functions created`);

            // Check default products
            const productResult = await this.pool.query('SELECT COUNT(*) as count FROM products');
            const productCount = parseInt(productResult.rows[0].count);
            console.log(`✅ ${productCount} products in database`);

            // Check indexes
            const indexResult = await this.pool.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE schemaname = 'public' 
                AND tablename IN ('users', 'keys', 'subscriptions', 'audit_logs')
                ORDER BY indexname
            `);
            
            const indexes = indexResult.rows.map(row => row.indexname);
            console.log(`✅ ${indexes.length} database indexes created`);

            return true;
        } catch (error) {
            console.error('❌ Verification failed:', error.message);
            return false;
        }
    }

    async getSystemInfo() {
        try {
            const dbInfo = await this.pool.query(`
                SELECT 
                    current_database() as database_name,
                    current_user as current_user,
                    version() as version
            `);
            
            const info = dbInfo.rows[0];
            console.log('\n📊 Database Information:');
            console.log(`   Database: ${info.database_name}`);
            console.log(`   User: ${info.current_user}`);
            console.log(`   Version: ${info.version.split(' ')[0]} ${info.version.split(' ')[1]}`);
            
        } catch (error) {
            console.log('ℹ️  Could not retrieve database information');
        }
    }

    async resetDatabase() {
        console.log('⚠️  WARNING: This will delete ALL data in the database!');
        const confirm = await question('Are you sure you want to reset the database? Type "RESET" to confirm: ');
        
        if (confirm !== 'RESET') {
            console.log('❌ Reset cancelled');
            return false;
        }

        try {
            console.log('🗑️  Dropping all tables...');
            
            // Get all tables
            const tablesResult = await this.pool.query(`
                SELECT tablename 
                FROM pg_tables 
                WHERE schemaname = 'public'
            `);
            
            // Drop tables in reverse dependency order
            const dropOrder = [
                'audit_logs', 'login_attempts', 'api_keys', 'purchases', 
                'subscriptions', 'keys', 'products', 'users'
            ];
            
            for (const table of dropOrder) {
                try {
                    await this.pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
                    console.log(`   ✅ Dropped table: ${table}`);
                } catch (error) {
                    console.log(`   ⚠️  Could not drop ${table}: ${error.message}`);
                }
            }

            // Drop functions
            const functions = [
                'deactivate_expired_subscriptions()',
                'user_has_active_subscription(VARCHAR)',
                'get_active_subscription(VARCHAR)',
                'create_admin_user(VARCHAR, VARCHAR)',
                'update_updated_at_column()'
            ];

            for (const func of functions) {
                try {
                    await this.pool.query(`DROP FUNCTION IF EXISTS ${func} CASCADE`);
                } catch (error) {
                    // Ignore errors for functions that don't exist
                }
            }

            console.log('✅ Database reset completed');
            return true;
        } catch (error) {
            console.error('❌ Error resetting database:', error.message);
            return false;
        }
    }
}

async function main() {
    console.log('🚀 CS2 Loader Database Setup');
    console.log('============================\n');

    const setup = new DatabaseSetup();

    try {
        // Connect to database
        await setup.connect();
        await setup.getSystemInfo();

        // Check current state
        const tableCheck = await setup.checkTablesExist();
        
        if (tableCheck.exists && tableCheck.total > 0) {
            console.log(`\n📋 Database already has ${tableCheck.total} tables`);
            console.log('   Tables:', tableCheck.existing.join(', '));
            
            const action = await question('\nWhat would you like to do?\n  1) Skip setup (database ready)\n  2) Reset and recreate\n  3) Verify current setup\nChoice (1-3): ');
            
            switch (action.trim()) {
                case '1':
                    console.log('✅ Database setup skipped - using existing tables');
                    return;
                case '2':
                    if (await setup.resetDatabase()) {
                        // Continue with setup
                        break;
                    } else {
                        return;
                    }
                case '3':
                    await setup.verifySetup();
                    return;
                default:
                    console.log('❌ Invalid choice');
                    return;
            }
        }

        // Run setup steps
        console.log('\n🔧 Starting database setup...\n');
        
        await setup.createSchema();
        await setup.createTriggers();
        await setup.seedDatabase();
        
        // Verify setup
        console.log('\n🔍 Verifying installation...');
        const verified = await setup.verifySetup();
        
        if (verified) {
            console.log('\n🎉 Database setup completed successfully!');
            console.log('\nNext steps:');
            console.log('  1. Run "npm run create-admin" to create an admin user');
            console.log('  2. Start the server with "npm run dev"');
            console.log('  3. Access the application at http://localhost:3000');
        } else {
            console.log('\n❌ Setup completed with warnings. Please check the logs above.');
        }

    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        
        if (error.message.includes('connect')) {
            console.log('\n💡 Troubleshooting tips:');
            console.log('  - Make sure PostgreSQL is running');
            console.log('  - Check your DATABASE_URL in .env file');
            console.log('  - Verify database credentials');
        }
        
        process.exit(1);
    } finally {
        await setup.disconnect();
        rl.close();
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
    console.log('\n\n👋 Setup interrupted');
    rl.close();
    process.exit(0);
});

if (require.main === module) {
    main();
}