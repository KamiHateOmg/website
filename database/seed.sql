-- CS2 Loader Web System - Sample Data for Testing and Development
-- This file contains sample data for testing the application

-- Note: This file should only be run in development/testing environments
-- DO NOT run this in production as it contains test data and weak passwords

-- Clear existing data (optional - uncomment if needed)
-- TRUNCATE TABLE audit_logs, login_attempts, purchases, subscriptions, keys, products, users RESTART IDENTITY CASCADE;

-- Insert sample products (if not already present from schema.sql)
INSERT INTO products (id, name, description, duration_days, price, is_active, is_featured, display_order) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440001', 'Free Trial', '1-day free trial access to CS2 Loader with basic features', 1, 0.00, true, false, 1),
    ('550e8400-e29b-41d4-a716-446655440002', 'Weekly Access', '7 days of full CS2 Loader access with all features unlocked', 7, 9.99, true, false, 2),
    ('550e8400-e29b-41d4-a716-446655440003', 'Monthly Access', '30 days of premium CS2 Loader access with priority support', 30, 29.99, true, true, 3),
    ('550e8400-e29b-41d4-a716-446655440004', 'Semi-Annual', '180 days of full access with exclusive features and early updates', 180, 149.99, true, true, 4),
    ('550e8400-e29b-41d4-a716-446655440005', 'Annual Access', '1 year of complete CS2 Loader access with VIP support', 365, 249.99, true, true, 5),
    ('550e8400-e29b-41d4-a716-446655440006', 'Lifetime Access', 'Permanent access to CS2 Loader with all future updates', 999999, 499.99, true, true, 6),
    ('550e8400-e29b-41d4-a716-446655440007', 'Beta Testing', '3-day beta access for testing new features', 3, 0.00, true, false, 7)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    updated_at = CURRENT_TIMESTAMP;

-- Insert sample users (passwords are all "TestPassword123!")
-- Admin user
INSERT INTO users (id, email, password_hash, role, hwid, email_verified, is_active, created_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440101', 'admin@cs2loader.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'admin', 'ADMIN-HWID-12345-ABCDE-67890', true, true, CURRENT_TIMESTAMP - INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;

-- Staff user
INSERT INTO users (id, email, password_hash, role, hwid, email_verified, is_active, created_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440102', 'staff@cs2loader.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'staff', 'STAFF-HWID-12345-ABCDE-67890', true, true, CURRENT_TIMESTAMP - INTERVAL '25 days')
ON CONFLICT (id) DO NOTHING;

-- Regular test users
INSERT INTO users (id, email, password_hash, role, hwid, email_verified, is_active, created_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440103', 'user1@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'user', 'USER1-HWID-12345-ABCDE-67890', true, true, CURRENT_TIMESTAMP - INTERVAL '20 days'),
    ('550e8400-e29b-41d4-a716-446655440104', 'user2@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'user', 'USER2-HWID-12345-ABCDE-67890', true, true, CURRENT_TIMESTAMP - INTERVAL '15 days'),
    ('550e8400-e29b-41d4-a716-446655440105', 'user3@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'user', 'USER3-HWID-12345-ABCDE-67890', false, true, CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('550e8400-e29b-41d4-a716-446655440106', 'inactive@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'user', 'INACTIVE-HWID-12345-ABCDE', true, false, CURRENT_TIMESTAMP - INTERVAL '5 days')
ON CONFLICT (id) DO NOTHING;

-- Insert sample keys
INSERT INTO keys (id, key_code, product_id, generated_by, purchased_by, redeemed_by, hwid_lock, redeemed_at, expires_at, is_active, created_at) 
VALUES 
    -- Redeemed keys
    ('550e8400-e29b-41d4-a716-446655440201', 'ABCD-EFGH-IJKL-MNOP', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440101', '550e8400-e29b-41d4-a716-446655440103', '550e8400-e29b-41d4-a716-446655440103', 'USER1-HWID-12345-ABCDE-67890', CURRENT_TIMESTAMP - INTERVAL '10 days', NULL, true, CURRENT_TIMESTAMP - INTERVAL '15 days'),
    ('550e8400-e29b-41d4-a716-446655440202', 'QRST-UVWX-YZ23-4567', '550e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440101', '550e8400-e29b-41d4-a716-446655440104', '550e8400-e29b-41d4-a716-446655440104', 'USER2-HWID-12345-ABCDE-67890', CURRENT_TIMESTAMP - INTERVAL '5 days', NULL, true, CURRENT_TIMESTAMP - INTERVAL '8 days'),
    
    -- Available keys
    ('550e8400-e29b-41d4-a716-446655440203', '89AB-CDEF-GH23-IJKL', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP + INTERVAL '30 days', true, CURRENT_TIMESTAMP - INTERVAL '5 days'),
    ('550e8400-e29b-41d4-a716-446655440204', 'MN4P-QR56-ST78-UVWX', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP + INTERVAL '60 days', true, CURRENT_TIMESTAMP - INTERVAL '3 days'),
    ('550e8400-e29b-41d4-a716-446655440205', 'YZ9A-BC23-DE45-FG67', '550e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440102', NULL, NULL, NULL, NULL, NULL, true, CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('550e8400-e29b-41d4-a716-446655440206', 'H8IJ-KL9M-NP23-QR45', '550e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, NULL, true, CURRENT_TIMESTAMP - INTERVAL '1 day'),
    
    -- Expired unused keys
    ('550e8400-e29b-41d4-a716-446655440207', 'ST67-UV89-WX23-YZ45', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '5 days', true, CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('550e8400-e29b-41d4-a716-446655440208', 'AB67-CD89-EF23-GH45', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440102', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '2 days', true, CURRENT_TIMESTAMP - INTERVAL '7 days'),
    
    -- Inactive keys
    ('550e8400-e29b-41d4-a716-446655440209', 'IJ89-KL23-MN45-PQ67', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP + INTERVAL '30 days', false, CURRENT_TIMESTAMP - INTERVAL '6 days'),
    
    -- Free trial keys
    ('550e8400-e29b-41d4-a716-446655440210', 'TR8L-FR33-T35T-K3Y1', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP + INTERVAL '7 days', true, CURRENT_TIMESTAMP),
    ('550e8400-e29b-41d4-a716-446655440211', 'TR8L-FR33-T35T-K3Y2', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP + INTERVAL '7 days', true, CURRENT_TIMESTAMP),
    ('550e8400-e29b-41d4-a716-446655440212', 'TR8L-FR33-T35T-K3Y3', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440101', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP + INTERVAL '7 days', true, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Insert sample subscriptions
INSERT INTO subscriptions (id, user_id, product_id, key_id, hwid, starts_at, expires_at, is_active, created_at) 
VALUES 
    -- Active subscriptions
    ('550e8400-e29b-41d4-a716-446655440301', '550e8400-e29b-41d4-a716-446655440103', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440201', 'USER1-HWID-12345-ABCDE-67890', CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP + INTERVAL '20 days', true, CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('550e8400-e29b-41d4-a716-446655440302', '550e8400-e29b-41d4-a716-446655440104', '550e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440202', 'USER2-HWID-12345-ABCDE-67890', CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP + INTERVAL '360 days', true, CURRENT_TIMESTAMP - INTERVAL '5 days'),
    
    -- Expired subscriptions
    ('550e8400-e29b-41d4-a716-446655440303', '550e8400-e29b-41d4-a716-446655440105', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440207', 'USER3-HWID-12345-ABCDE-67890', CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP - INTERVAL '8 days', false, CURRENT_TIMESTAMP - INTERVAL '15 days')
ON CONFLICT (id) DO NOTHING;

-- Insert sample purchases
INSERT INTO purchases (id, user_id, product_id, key_id, amount, payment_method, payment_status, transaction_id, ip_address, created_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440401', '550e8400-e29b-41d4-a716-446655440103', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440201', 29.99, 'key_redemption', 'completed', 'TXN_001_MONTHLY', '192.168.1.100', CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('550e8400-e29b-41d4-a716-446655440402', '550e8400-e29b-41d4-a716-446655440104', '550e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440202', 249.99, 'key_redemption', 'completed', 'TXN_002_ANNUAL', '192.168.1.101', CURRENT_TIMESTAMP - INTERVAL '5 days'),
    ('550e8400-e29b-41d4-a716-446655440403', '550e8400-e29b-41d4-a716-446655440105', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440207', 9.99, 'key_redemption', 'completed', 'TXN_003_WEEKLY', '192.168.1.102', CURRENT_TIMESTAMP - INTERVAL '15 days')
ON CONFLICT (id) DO NOTHING;

-- Insert sample audit logs
INSERT INTO audit_logs (id, user_id, action, details, ip_address, user_agent, created_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440501', '550e8400-e29b-41d4-a716-446655440101', 'ADMIN_LOGIN', '{"method": "password", "success": true}', '192.168.1.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
    ('550e8400-e29b-41d4-a716-446655440502', '550e8400-e29b-41d4-a716-446655440101', 'ADMIN_BULK_KEY_GENERATION', '{"product_id": "550e8400-e29b-41d4-a716-446655440001", "quantity": 5, "description": "Free trial keys for testing"}', '192.168.1.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
    ('550e8400-e29b-41d4-a716-446655440503', '550e8400-e29b-41d4-a716-446655440103', 'USER_LOGIN', '{"method": "password", "hwid": "USER1-HWID-12345-ABCDE-67890"}', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    ('550e8400-e29b-41d4-a716-446655440504', '550e8400-e29b-41d4-a716-446655440103', 'KEY_REDEEMED', '{"key_code": "ABCD-EFGH-IJKL-MNOP", "product_name": "Monthly Access", "hwid": "USER1-HWID-12345-ABCDE-67890"}', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('550e8400-e29b-41d4-a716-446655440505', '550e8400-e29b-41d4-a716-446655440104', 'USER_REGISTER', '{"email": "user2@example.com", "verification_required": true}', '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '15 days'),
    ('550e8400-e29b-41d4-a716-446655440506', NULL, 'DESKTOP_AUTH_CHECK', '{"hwid": "USER1-HWID-12345-ABCDE-67890", "success": true}', '192.168.1.100', 'CS2Loader-Desktop/1.0', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
    ('550e8400-e29b-41d4-a716-446655440507', NULL, 'DESKTOP_AUTH_CHECK', '{"hwid": "USER2-HWID-12345-ABCDE-67890", "success": true}', '192.168.1.101', 'CS2Loader-Desktop/1.0', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
    ('550e8400-e29b-41d4-a716-446655440508', '550e8400-e29b-41d4-a716-446655440102', 'USER_LOGIN', '{"method": "password", "role": "staff"}', '192.168.1.50', 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '3 hours')
ON CONFLICT (id) DO NOTHING;

-- Insert sample login attempts
INSERT INTO login_attempts (id, email, ip_address, success, user_agent, created_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440601', 'admin@cs2loader.com', '192.168.1.1', true, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
    ('550e8400-e29b-41d4-a716-446655440602', 'user1@example.com', '192.168.1.100', true, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    ('550e8400-e29b-41d4-a716-446655440603', 'user2@example.com', '192.168.1.101', true, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '3 hours'),
    ('550e8400-e29b-41d4-a716-446655440604', 'nonexistent@example.com', '192.168.1.200', false, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '4 hours'),
    ('550e8400-e29b-41d4-a716-446655440605', 'admin@cs2loader.com', '192.168.1.200', false, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '5 hours'),
    ('550e8400-e29b-41d4-a716-446655440606', 'staff@cs2loader.com', '192.168.1.50', true, 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '3 hours')
ON CONFLICT (id) DO NOTHING;

-- Insert sample API keys (for desktop app authentication)
INSERT INTO api_keys (id, key_hash, name, is_active, last_used, created_by, created_at, expires_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440701', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/A5pkY.5Qy', 'Desktop App API Key - Production', true, CURRENT_TIMESTAMP - INTERVAL '1 hour', '550e8400-e29b-41d4-a716-446655440101', CURRENT_TIMESTAMP - INTERVAL '30 days', NULL),
    ('550e8400-e29b-41d4-a716-446655440702', '$2b$12$DifferentHashForTestingPurposesOnlyDoNotUseInProduction123', 'Desktop App API Key - Testing', true, CURRENT_TIMESTAMP - INTERVAL '2 hours', '550e8400-e29b-41d4-a716-446655440101', CURRENT_TIMESTAMP - INTERVAL '7 days', CURRENT_TIMESTAMP + INTERVAL '30 days'),
    ('550e8400-e29b-41d4-a716-446655440703', '$2b$12$AnotherTestHashForDevelopmentEnvironmentOnly567890ABCDEF', 'Development API Key', false, NULL, '550e8400-e29b-41d4-a716-446655440102', CURRENT_TIMESTAMP - INTERVAL '1 day', NULL)
ON CONFLICT (id) DO NOTHING;

-- Update user last_login timestamps to make them more realistic
UPDATE users SET 
    last_login = CASE 
        WHEN email = 'admin@cs2loader.com' THEN CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHEN email = 'staff@cs2loader.com' THEN CURRENT_TIMESTAMP - INTERVAL '3 hours'
        WHEN email = 'user1@example.com' THEN CURRENT_TIMESTAMP - INTERVAL '2 hours'
        WHEN email = 'user2@example.com' THEN CURRENT_TIMESTAMP - INTERVAL '1 day'
        WHEN email = 'user3@example.com' THEN CURRENT_TIMESTAMP - INTERVAL '3 days'
        ELSE last_login
    END,
    last_ip = CASE 
        WHEN email = 'admin@cs2loader.com' THEN '192.168.1.1'
        WHEN email = 'staff@cs2loader.com' THEN '192.168.1.50'
        WHEN email = 'user1@example.com' THEN '192.168.1.100'
        WHEN email = 'user2@example.com' THEN '192.168.1.101'
        WHEN email = 'user3@example.com' THEN '192.168.1.102'
        ELSE last_ip
    END
WHERE email IN ('admin@cs2loader.com', 'staff@cs2loader.com', 'user1@example.com', 'user2@example.com', 'user3@example.com');

-- Create some additional sample data for better testing

-- Insert more sample keys for each product type
DO $
DECLARE
    product_rec RECORD;
    i INTEGER;
    key_prefix TEXT;
BEGIN
    FOR product_rec IN SELECT id, name FROM products WHERE is_active = true LOOP
        -- Generate different key prefixes based on product
        key_prefix := CASE 
            WHEN product_rec.name LIKE '%Trial%' THEN 'TRIAL'
            WHEN product_rec.name LIKE '%Weekly%' THEN 'WEEK'
            WHEN product_rec.name LIKE '%Monthly%' THEN 'MONTH'
            WHEN product_rec.name LIKE '%Semi%' THEN 'SEMI'
            WHEN product_rec.name LIKE '%Annual%' THEN 'YEAR'
            WHEN product_rec.name LIKE '%Lifetime%' THEN 'LIFE'
            WHEN product_rec.name LIKE '%Beta%' THEN 'BETA'
            ELSE 'PROD'
        END;
        
        -- Generate 3-5 additional keys per product
        FOR i IN 1..3 LOOP
            INSERT INTO keys (key_code, product_id, generated_by, expires_at, is_active, created_at) 
            VALUES (
                key_prefix || '-' || LPAD(i::TEXT, 4, '0') || '-TEST-' || LPAD((RANDOM() * 9999)::INTEGER::TEXT, 4, '0'),
                product_rec.id,
                '550e8400-e29b-41d4-a716-446655440101', -- Admin user
                CASE 
                    WHEN RANDOM() < 0.7 THEN CURRENT_TIMESTAMP + INTERVAL '30 days'
                    ELSE NULL
                END,
                true,
                CURRENT_TIMESTAMP - (RANDOM() * INTERVAL '10 days')
            ) ON CONFLICT (key_code) DO NOTHING;
        END LOOP;
    END LOOP;
END $;

-- Add some sample system events to audit logs
INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) 
VALUES 
    (NULL, 'SYSTEM_STARTUP', '{"version": "1.0.0", "environment": "development"}', '127.0.0.1', CURRENT_TIMESTAMP - INTERVAL '1 day'),
    ('550e8400-e29b-41d4-a716-446655440101', 'ADMIN_SYSTEM_CLEANUP', '{"operations": ["expired_subscriptions", "old_logs"], "cleaned_items": 15}', '192.168.1.1', CURRENT_TIMESTAMP - INTERVAL '12 hours'),
    (NULL, 'RATE_LIMIT_EXCEEDED', '{"ip": "192.168.1.200", "endpoint": "/api/auth/login", "attempts": 6}', '192.168.1.200', CURRENT_TIMESTAMP - INTERVAL '6 hours'),
    ('550e8400-e29b-41d4-a716-446655440102', 'ADMIN_USER_DATA_EXPORT', '{"exported_user": "user3@example.com", "data_size": "2.3KB"}', '192.168.1.50', CURRENT_TIMESTAMP - INTERVAL '3 hours')
ON CONFLICT (id) DO NOTHING;

-- Create a summary view for easy data verification
CREATE OR REPLACE VIEW sample_data_summary AS
SELECT 
    'Users' as entity,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE is_active = true) as active_count,
    COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
    COUNT(*) FILTER (WHERE role = 'staff') as staff_count,
    COUNT(*) FILTER (WHERE role = 'user') as user_count
FROM users
UNION ALL
SELECT 
    'Products' as entity,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE is_active = true) as active_count,
    COUNT(*) FILTER (WHERE is_featured = true) as featured_count,
    COUNT(*) FILTER (WHERE price = 0) as free_count,
    COUNT(*) FILTER (WHERE price > 0) as paid_count
FROM products
UNION ALL
SELECT 
    'Keys' as entity,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE is_active = true) as active_count,
    COUNT(*) FILTER (WHERE redeemed_by IS NOT NULL) as redeemed_count,
    COUNT(*) FILTER (WHERE redeemed_by IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) as available_count,
    COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP AND redeemed_by IS NULL) as expired_count
FROM keys
UNION ALL
SELECT 
    'Subscriptions' as entity,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE is_active = true) as active_count,
    COUNT(*) FILTER (WHERE expires_at > CURRENT_TIMESTAMP) as valid_count,
    COUNT(*) FILTER (WHERE expires_at <= CURRENT_TIMESTAMP) as expired_count,
    0 as unused_column
FROM subscriptions
UNION ALL
SELECT 
    'Purchases' as entity,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE payment_status = 'completed') as completed_count,
    COUNT(*) FILTER (WHERE payment_status = 'pending') as pending_count,
    COUNT(*) FILTER (WHERE payment_status = 'failed') as failed_count,
    0 as unused_column
FROM purchases
UNION ALL
SELECT 
    'Audit Logs' as entity,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') as last_24h_count,
    COUNT(*) FILTER (WHERE action LIKE '%LOGIN%') as login_events_count,
    COUNT(*) FILTER (WHERE action LIKE '%ADMIN%') as admin_events_count,
    COUNT(*) FILTER (WHERE action LIKE '%KEY%') as key_events_count
FROM audit_logs;

-- Display summary of seeded data
SELECT * FROM sample_data_summary ORDER BY entity;

-- Final message
DO $
BEGIN
    RAISE NOTICE '✅ Sample data seeding completed successfully!';
    RAISE NOTICE '📊 Summary of seeded data:';
    RAISE NOTICE '   - Test users with various roles (admin, staff, user)';
    RAISE NOTICE '   - Sample products with different pricing tiers';
    RAISE NOTICE '   - Keys in various states (redeemed, available, expired)';
    RAISE NOTICE '   - Active and expired subscriptions';
    RAISE NOTICE '   - Purchase history and audit logs';
    RAISE NOTICE '   - Sample API keys for desktop app testing';
    RAISE NOTICE '';
    RAISE NOTICE '🔑 Test Credentials (password: TestPassword123!):';
    RAISE NOTICE '   - Admin: admin@cs2loader.com';
    RAISE NOTICE '   - Staff: staff@cs2loader.com';
    RAISE NOTICE '   - User: user1@example.com, user2@example.com';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  NOTE: This data is for DEVELOPMENT/TESTING only!';
    RAISE NOTICE '   DO NOT use in production environments.';
END $;