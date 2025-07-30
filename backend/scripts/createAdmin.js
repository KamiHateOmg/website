const readline = require('readline');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function questionHidden(query) {
    return new Promise(resolve => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        
        stdout.write(query);
        stdin.resume();
        stdin.setRawMode(true);
        
        let password = '';
        stdin.on('data', char => {
            char = char.toString();
            switch (char) {
                case '\n':
                case '\r':
                case '\u0004': // Ctrl+D
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdout.write('\n');
                    resolve(password);
                    break;
                case '\u0003': // Ctrl+C
                    process.exit();
                    break;
                case '\u007f': // Backspace
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        stdout.write('\b \b');
                    }
                    break;
                default:
                    password += char;
                    stdout.write('*');
                    break;
            }
        });
    });
}

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePassword(password) {
    if (password.length < 8) {
        return 'Password must be at least 8 characters long';
    }
    if (!/(?=.*[a-z])/.test(password)) {
        return 'Password must contain at least one lowercase letter';
    }
    if (!/(?=.*[A-Z])/.test(password)) {
        return 'Password must contain at least one uppercase letter';
    }
    if (!/(?=.*\d)/.test(password)) {
        return 'Password must contain at least one number';
    }
    return null;
}

async function checkDatabaseConnection() {
    try {
        await pool.query('SELECT 1');
        console.log('✅ Database connection successful');
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Please check your DATABASE_URL environment variable');
        return false;
    }
}

async function checkIfAdminExists() {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE role = \'admin\''
        );
        return parseInt(result.rows[0].count) > 0;
    } catch (error) {
        console.error('Error checking for existing admins:', error.message);
        return false;
    }
}

async function createAdminUser(email, password) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Check if user already exists
        const existingUser = await client.query(
            'SELECT id, role FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            const user = existingUser.rows[0];
            if (user.role === 'admin') {
                throw new Error('An admin user with this email already exists');
            } else {
                // Upgrade existing user to admin
                const passwordHash = await bcrypt.hash(password, 12);
                await client.query(
                    'UPDATE users SET password_hash = $1, role = $2, email_verified = TRUE WHERE id = $3',
                    [passwordHash, 'admin', user.id]
                );

                await client.query(
                    'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
                    [user.id, 'USER_UPGRADED_TO_ADMIN', JSON.stringify({ method: 'script' })]
                );

                await client.query('COMMIT');
                return { id: user.id, email, upgraded: true };
            }
        }

        // Create new admin user
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await client.query(
            `INSERT INTO users (email, password_hash, role, email_verified, is_active) 
             VALUES ($1, $2, 'admin', TRUE, TRUE) 
             RETURNING id, email, created_at`,
            [email, passwordHash]
        );

        const newAdmin = result.rows[0];

        // Log the creation
        await client.query(
            'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
            [newAdmin.id, 'ADMIN_USER_CREATED', JSON.stringify({ method: 'script', createdAt: new Date() })]
        );

        await client.query('COMMIT');
        return { id: newAdmin.id, email: newAdmin.email, created: true, createdAt: newAdmin.created_at };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    console.log('🔧 CS2 Loader Admin User Creation Tool');
    console.log('=====================================\n');

    // Check database connection
    if (!(await checkDatabaseConnection())) {
        process.exit(1);
    }

    // Check if admin already exists
    const adminExists = await checkIfAdminExists();
    if (adminExists) {
        console.log('ℹ️  Admin users already exist in the system');
        const proceed = await question('Do you want to create another admin user? (y/N): ');
        if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
            console.log('👋 Exiting without creating admin user');
            process.exit(0);
        }
    }

    try {
        // Get email
        let email;
        while (true) {
            email = await question('Enter admin email: ');
            if (validateEmail(email)) {
                break;
            }
            console.log('❌ Please enter a valid email address');
        }

        // Get password
        let password;
        while (true) {
            password = await questionHidden('Enter admin password: ');
            const passwordError = validatePassword(password);
            if (!passwordError) {
                break;
            }
            console.log(`❌ ${passwordError}`);
        }

        // Confirm password
        const confirmPassword = await questionHidden('Confirm admin password: ');
        if (password !== confirmPassword) {
            console.log('❌ Passwords do not match');
            process.exit(1);
        }

        console.log('\n🔨 Creating admin user...');
        
        const result = await createAdminUser(email, password);
        
        console.log('\n✅ Admin user created successfully!');
        console.log(`📧 Email: ${result.email}`);
        console.log(`🆔 User ID: ${result.id}`);
        
        if (result.upgraded) {
            console.log('ℹ️  Note: Existing user was upgraded to admin role');
        } else {
            console.log(`📅 Created: ${result.createdAt}`);
        }

        console.log('\n🎉 Admin user is ready to use!');
        console.log('You can now log in to the admin panel with these credentials.');

    } catch (error) {
        console.error('\n❌ Error creating admin user:', error.message);
        process.exit(1);
    } finally {
        rl.close();
        await pool.end();
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
    console.log('\n\n👋 Goodbye!');
    rl.close();
    await pool.end();
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
    console.error('\n❌ Uncaught error:', error.message);
    rl.close();
    await pool.end();
    process.exit(1);
});

if (require.main === module) {
    main();
}