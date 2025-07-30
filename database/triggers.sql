-- CS2 Loader Web System - Database Triggers and Stored Procedures
-- This file contains additional triggers, functions, and stored procedures

-- Enhanced logging function for better audit trails
CREATE OR REPLACE FUNCTION log_user_activity()
RETURNS TRIGGER AS $$
BEGIN
    -- Log user creation
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (user_id, action, details, ip_address)
        VALUES (NEW.id, 'USER_CREATED', 
                json_build_object(
                    'email', NEW.email,
                    'role', NEW.role,
                    'email_verified', NEW.email_verified
                )::jsonb, 
                inet_client_addr()::text);
        RETURN NEW;
    END IF;

    -- Log user updates
    IF TG_OP = 'UPDATE' THEN
        -- Log role changes
        IF OLD.role != NEW.role THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.id, 'USER_ROLE_CHANGED', 
                    json_build_object(
                        'old_role', OLD.role,
                        'new_role', NEW.role,
                        'email', NEW.email
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        -- Log account status changes
        IF OLD.is_active != NEW.is_active THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.id, 
                    CASE WHEN NEW.is_active THEN 'USER_ACTIVATED' ELSE 'USER_DEACTIVATED' END,
                    json_build_object(
                        'email', NEW.email,
                        'previous_status', OLD.is_active,
                        'new_status', NEW.is_active
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        -- Log email verification
        IF OLD.email_verified = FALSE AND NEW.email_verified = TRUE THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.id, 'EMAIL_VERIFIED', 
                    json_build_object('email', NEW.email)::jsonb, 
                    inet_client_addr()::text);
        END IF;

        -- Log HWID changes
        IF OLD.hwid IS DISTINCT FROM NEW.hwid THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.id, 'HWID_UPDATED', 
                    json_build_object(
                        'email', NEW.email,
                        'old_hwid', OLD.hwid,
                        'new_hwid', NEW.hwid
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        RETURN NEW;
    END IF;

    -- Log user deletion
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (user_id, action, details, ip_address)
        VALUES (OLD.id, 'USER_DELETED', 
                json_build_object(
                    'email', OLD.email,
                    'role', OLD.role,
                    'was_active', OLD.is_active
                )::jsonb, 
                inet_client_addr()::text);
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for user activity logging
DROP TRIGGER IF EXISTS user_activity_trigger ON users;
CREATE TRIGGER user_activity_trigger
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION log_user_activity();

-- Function to log key operations
CREATE OR REPLACE FUNCTION log_key_operations()
RETURNS TRIGGER AS $$
BEGIN
    -- Log key creation
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (user_id, action, details, ip_address)
        VALUES (NEW.generated_by, 'KEY_GENERATED', 
                json_build_object(
                    'key_code', NEW.key_code,
                    'product_id', NEW.product_id,
                    'expires_at', NEW.expires_at
                )::jsonb, 
                inet_client_addr()::text);
        RETURN NEW;
    END IF;

    -- Log key updates (redemption, deactivation, etc.)
    IF TG_OP = 'UPDATE' THEN
        -- Log key redemption
        IF OLD.redeemed_by IS NULL AND NEW.redeemed_by IS NOT NULL THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.redeemed_by, 'KEY_REDEEMED', 
                    json_build_object(
                        'key_code', NEW.key_code,
                        'product_id', NEW.product_id,
                        'hwid_lock', NEW.hwid_lock,
                        'redemption_ip', NEW.redemption_ip
                    )::jsonb, 
                    NEW.redemption_ip);
        END IF;

        -- Log key deactivation
        IF OLD.is_active = TRUE AND NEW.is_active = FALSE THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.generated_by, 'KEY_DEACTIVATED', 
                    json_build_object(
                        'key_code', NEW.key_code,
                        'product_id', NEW.product_id,
                        'was_redeemed', NEW.redeemed_by IS NOT NULL
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        RETURN NEW;
    END IF;

    -- Log key deletion
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (user_id, action, details, ip_address)
        VALUES (OLD.generated_by, 'KEY_DELETED', 
                json_build_object(
                    'key_code', OLD.key_code,
                    'product_id', OLD.product_id,
                    'was_redeemed', OLD.redeemed_by IS NOT NULL
                )::jsonb, 
                inet_client_addr()::text);
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$ LANGUAGE plpgsql;

-- Create trigger for key operations logging
DROP TRIGGER IF EXISTS key_operations_trigger ON keys;
CREATE TRIGGER key_operations_trigger
    AFTER INSERT OR UPDATE OR DELETE ON keys
    FOR EACH ROW EXECUTE FUNCTION log_key_operations();

-- Function to manage subscription lifecycle
CREATE OR REPLACE FUNCTION manage_subscription_lifecycle()
RETURNS TRIGGER AS $
BEGIN
    -- Log subscription creation
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (user_id, action, details, ip_address)
        VALUES (NEW.user_id, 'SUBSCRIPTION_CREATED', 
                json_build_object(
                    'product_id', NEW.product_id,
                    'hwid', NEW.hwid,
                    'starts_at', NEW.starts_at,
                    'expires_at', NEW.expires_at,
                    'key_id', NEW.key_id
                )::jsonb, 
                inet_client_addr()::text);
        RETURN NEW;
    END IF;

    -- Log subscription updates
    IF TG_OP = 'UPDATE' THEN
        -- Log subscription deactivation
        IF OLD.is_active = TRUE AND NEW.is_active = FALSE THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.user_id, 'SUBSCRIPTION_DEACTIVATED', 
                    json_build_object(
                        'subscription_id', NEW.id,
                        'product_id', NEW.product_id,
                        'hwid', NEW.hwid,
                        'expires_at', NEW.expires_at,
                        'reason', CASE 
                            WHEN NEW.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                            ELSE 'manual'
                        END
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        -- Log subscription reactivation
        IF OLD.is_active = FALSE AND NEW.is_active = TRUE THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.user_id, 'SUBSCRIPTION_REACTIVATED', 
                    json_build_object(
                        'subscription_id', NEW.id,
                        'product_id', NEW.product_id,
                        'hwid', NEW.hwid,
                        'expires_at', NEW.expires_at
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        -- Log subscription extension
        IF OLD.expires_at != NEW.expires_at AND NEW.expires_at > OLD.expires_at THEN
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (NEW.user_id, 'SUBSCRIPTION_EXTENDED', 
                    json_build_object(
                        'subscription_id', NEW.id,
                        'product_id', NEW.product_id,
                        'old_expires_at', OLD.expires_at,
                        'new_expires_at', NEW.expires_at,
                        'extension_days', EXTRACT(DAY FROM (NEW.expires_at - OLD.expires_at))
                    )::jsonb, 
                    inet_client_addr()::text);
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$ LANGUAGE plpgsql;

-- Create trigger for subscription lifecycle management
DROP TRIGGER IF EXISTS subscription_lifecycle_trigger ON subscriptions;
CREATE TRIGGER subscription_lifecycle_trigger
    AFTER INSERT OR UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION manage_subscription_lifecycle();

-- Function to automatically deactivate expired subscriptions
CREATE OR REPLACE FUNCTION auto_deactivate_expired_subscriptions()
RETURNS INTEGER AS $
DECLARE
    expired_count INTEGER;
    expired_sub RECORD;
BEGIN
    expired_count := 0;
    
    -- Find and deactivate expired subscriptions
    FOR expired_sub IN 
        SELECT id, user_id, product_id, hwid, expires_at
        FROM subscriptions 
        WHERE is_active = TRUE 
        AND expires_at <= CURRENT_TIMESTAMP
    LOOP
        -- Deactivate the subscription
        UPDATE subscriptions 
        SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id = expired_sub.id;
        
        -- Log the expiration
        INSERT INTO audit_logs (user_id, action, details, ip_address)
        VALUES (expired_sub.user_id, 'SUBSCRIPTION_EXPIRED', 
                json_build_object(
                    'subscription_id', expired_sub.id,
                    'product_id', expired_sub.product_id,
                    'hwid', expired_sub.hwid,
                    'expired_at', expired_sub.expires_at,
                    'auto_deactivated', true
                )::jsonb, 
                '127.0.0.1');
        
        expired_count := expired_count + 1;
    END LOOP;
    
    RETURN expired_count;
END;
$ LANGUAGE plpgsql;

-- Enhanced function to get active subscription with more details
CREATE OR REPLACE FUNCTION get_active_subscription_detailed(user_hwid VARCHAR)
RETURNS TABLE (
    subscription_id UUID,
    user_id UUID,
    user_email VARCHAR,
    product_id UUID,
    product_name VARCHAR,
    product_duration INTEGER,
    key_id UUID,
    key_code VARCHAR,
    hwid VARCHAR,
    starts_at TIMESTAMP,
    expires_at TIMESTAMP,
    days_remaining NUMERIC,
    hours_remaining NUMERIC,
    is_lifetime BOOLEAN,
    subscription_status VARCHAR
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.user_id,
        u.email,
        s.product_id,
        p.name,
        p.duration_days,
        s.key_id,
        k.key_code,
        s.hwid,
        s.starts_at,
        s.expires_at,
        EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400 as days_remaining,
        EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 3600 as hours_remaining,
        p.duration_days = 999999 as is_lifetime,
        CASE 
            WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
            WHEN s.expires_at <= CURRENT_TIMESTAMP + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
        END as subscription_status
    FROM subscriptions s
    JOIN products p ON s.product_id = p.id
    JOIN keys k ON s.key_id = k.id
    JOIN users u ON s.user_id = u.id
    WHERE s.hwid = user_hwid 
    AND s.is_active = TRUE 
    AND s.expires_at > CURRENT_TIMESTAMP
    ORDER BY s.expires_at DESC
    LIMIT 1;
END;
$ LANGUAGE plpgsql;

-- Function to get subscription statistics
CREATE OR REPLACE FUNCTION get_subscription_stats()
RETURNS TABLE (
    total_subscriptions BIGINT,
    active_subscriptions BIGINT,
    expired_subscriptions BIGINT,
    expiring_soon BIGINT,
    lifetime_subscriptions BIGINT,
    avg_subscription_duration NUMERIC,
    most_popular_product VARCHAR,
    total_revenue NUMERIC
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM subscriptions) as total_subscriptions,
        (SELECT COUNT(*) FROM subscriptions WHERE is_active = TRUE AND expires_at > CURRENT_TIMESTAMP) as active_subscriptions,
        (SELECT COUNT(*) FROM subscriptions WHERE expires_at <= CURRENT_TIMESTAMP) as expired_subscriptions,
        (SELECT COUNT(*) FROM subscriptions WHERE is_active = TRUE AND expires_at <= CURRENT_TIMESTAMP + INTERVAL '7 days' AND expires_at > CURRENT_TIMESTAMP) as expiring_soon,
        (SELECT COUNT(*) FROM subscriptions s JOIN products p ON s.product_id = p.id WHERE p.duration_days = 999999) as lifetime_subscriptions,
        (SELECT AVG(EXTRACT(DAY FROM (expires_at - starts_at))) FROM subscriptions WHERE expires_at > starts_at) as avg_subscription_duration,
        (SELECT p.name FROM subscriptions s JOIN products p ON s.product_id = p.id GROUP BY p.name ORDER BY COUNT(*) DESC LIMIT 1) as most_popular_product,
        (SELECT COALESCE(SUM(amount), 0) FROM purchases WHERE payment_status = 'completed') as total_revenue;
END;
$ LANGUAGE plpgsql;

-- Function to clean up old audit logs
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_logs 
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL
    AND action NOT LIKE '%ADMIN%'  -- Keep admin actions longer
    AND action NOT LIKE '%SECURITY%'; -- Keep security events longer
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Log the cleanup operation
    INSERT INTO audit_logs (action, details, ip_address)
    VALUES ('AUDIT_LOG_CLEANUP', 
            json_build_object(
                'deleted_count', deleted_count,
                'retention_days', retention_days,
                'cleanup_date', CURRENT_TIMESTAMP
            )::jsonb, 
            '127.0.0.1');
    
    RETURN deleted_count;
END;
$ LANGUAGE plpgsql;

-- Function to clean up old login attempts
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM login_attempts 
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Log the cleanup operation
    INSERT INTO audit_logs (action, details, ip_address)
    VALUES ('LOGIN_ATTEMPTS_CLEANUP', 
            json_build_object(
                'deleted_count', deleted_count,
                'retention_days', retention_days,
                'cleanup_date', CURRENT_TIMESTAMP
            )::jsonb, 
            '127.0.0.1');
    
    RETURN deleted_count;
END;
$ LANGUAGE plpgsql;

-- Function to get system health metrics
CREATE OR REPLACE FUNCTION get_system_health()
RETURNS TABLE (
    metric_name VARCHAR,
    metric_value NUMERIC,
    metric_status VARCHAR,
    last_updated TIMESTAMP
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        'active_users_24h'::VARCHAR as metric_name,
        (SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours' AND user_id IS NOT NULL)::NUMERIC as metric_value,
        'normal'::VARCHAR as metric_status,
        CURRENT_TIMESTAMP as last_updated
    UNION ALL
    SELECT 
        'failed_logins_1h'::VARCHAR,
        (SELECT COUNT(*) FROM login_attempts WHERE success = FALSE AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour')::NUMERIC,
        CASE WHEN (SELECT COUNT(*) FROM login_attempts WHERE success = FALSE AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') > 50 THEN 'warning' ELSE 'normal' END::VARCHAR,
        CURRENT_TIMESTAMP
    UNION ALL
    SELECT 
        'active_subscriptions'::VARCHAR,
        (SELECT COUNT(*) FROM subscriptions WHERE is_active = TRUE AND expires_at > CURRENT_TIMESTAMP)::NUMERIC,
        'normal'::VARCHAR,
        CURRENT_TIMESTAMP
    UNION ALL
    SELECT 
        'expired_subscriptions_pending'::VARCHAR,
        (SELECT COUNT(*) FROM subscriptions WHERE is_active = TRUE AND expires_at <= CURRENT_TIMESTAMP)::NUMERIC,
        CASE WHEN (SELECT COUNT(*) FROM subscriptions WHERE is_active = TRUE AND expires_at <= CURRENT_TIMESTAMP) > 10 THEN 'warning' ELSE 'normal' END::VARCHAR,
        CURRENT_TIMESTAMP
    UNION ALL
    SELECT 
        'database_size_mb'::VARCHAR,
        (SELECT pg_database_size(current_database()) / 1024 / 1024)::NUMERIC,
        'normal'::VARCHAR,
        CURRENT_TIMESTAMP
    UNION ALL
    SELECT 
        'total_keys_available'::VARCHAR,
        (SELECT COUNT(*) FROM keys WHERE is_active = TRUE AND redeemed_by IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP))::NUMERIC,
        CASE WHEN (SELECT COUNT(*) FROM keys WHERE is_active = TRUE AND redeemed_by IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) < 10 THEN 'warning' ELSE 'normal' END::VARCHAR,
        CURRENT_TIMESTAMP;
END;
$ LANGUAGE plpgsql;

-- Function to validate and fix data integrity
CREATE OR REPLACE FUNCTION check_data_integrity()
RETURNS TABLE (
    check_name VARCHAR,
    issue_count INTEGER,
    issue_description TEXT,
    suggested_action TEXT
) AS $
BEGIN
    RETURN QUERY
    -- Check for orphaned subscriptions
    SELECT 
        'orphaned_subscriptions'::VARCHAR as check_name,
        COUNT(*)::INTEGER as issue_count,
        'Subscriptions without valid users or products'::TEXT as issue_description,
        'Review and remove invalid subscriptions'::TEXT as suggested_action
    FROM subscriptions s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN products p ON s.product_id = p.id
    WHERE u.id IS NULL OR p.id IS NULL
    
    UNION ALL
    
    -- Check for keys without valid products
    SELECT 
        'orphaned_keys'::VARCHAR,
        COUNT(*)::INTEGER,
        'Keys without valid products'::TEXT,
        'Review and remove invalid keys'::TEXT
    FROM keys k
    LEFT JOIN products p ON k.product_id = p.id
    WHERE p.id IS NULL
    
    UNION ALL
    
    -- Check for purchases without valid references
    SELECT 
        'orphaned_purchases'::VARCHAR,
        COUNT(*)::INTEGER,
        'Purchases without valid user, product, or key references'::TEXT,
        'Review and fix purchase records'::TEXT
    FROM purchases pu
    LEFT JOIN users u ON pu.user_id = u.id
    LEFT JOIN products p ON pu.product_id = p.id
    LEFT JOIN keys k ON pu.key_id = k.id
    WHERE u.id IS NULL OR p.id IS NULL OR k.id IS NULL
    
    UNION ALL
    
    -- Check for multiple active subscriptions per HWID
    SELECT 
        'duplicate_active_subscriptions'::VARCHAR,
        COUNT(*)::INTEGER,
        'Multiple active subscriptions for the same HWID'::TEXT,
        'Deactivate duplicate subscriptions'::TEXT
    FROM (
        SELECT hwid, COUNT(*) as sub_count
        FROM subscriptions 
        WHERE is_active = TRUE AND expires_at > CURRENT_TIMESTAMP
        GROUP BY hwid
        HAVING COUNT(*) > 1
    ) duplicates
    
    UNION ALL
    
    -- Check for redeemed keys without subscriptions
    SELECT 
        'redeemed_keys_no_subscription'::VARCHAR,
        COUNT(*)::INTEGER,
        'Keys that are redeemed but have no corresponding subscription'::TEXT,
        'Create missing subscriptions or mark keys as unredeemed'::TEXT
    FROM keys k
    LEFT JOIN subscriptions s ON k.id = s.key_id
    WHERE k.redeemed_by IS NOT NULL AND s.id IS NULL;
END;
$ LANGUAGE plpgsql;

-- Function to create automated maintenance schedule
CREATE OR REPLACE FUNCTION schedule_maintenance()
RETURNS TEXT AS $
DECLARE
    result_text TEXT := '';
    expired_subs INTEGER;
    cleaned_logs INTEGER;
    cleaned_attempts INTEGER;
BEGIN
    -- Auto-deactivate expired subscriptions
    SELECT auto_deactivate_expired_subscriptions() INTO expired_subs;
    result_text := result_text || format('Deactivated %s expired subscriptions. ', expired_subs);
    
    -- Clean up old audit logs (keep for 90 days)
    SELECT cleanup_old_audit_logs(90) INTO cleaned_logs;
    result_text := result_text || format('Cleaned %s old audit logs. ', cleaned_logs);
    
    -- Clean up old login attempts (keep for 30 days)
    SELECT cleanup_old_login_attempts(30) INTO cleaned_attempts;
    result_text := result_text || format('Cleaned %s old login attempts. ', cleaned_attempts);
    
    -- Log the maintenance operation
    INSERT INTO audit_logs (action, details, ip_address)
    VALUES ('SCHEDULED_MAINTENANCE', 
            json_build_object(
                'expired_subscriptions', expired_subs,
                'cleaned_audit_logs', cleaned_logs,
                'cleaned_login_attempts', cleaned_attempts,
                'maintenance_date', CURRENT_TIMESTAMP
            )::jsonb, 
            '127.0.0.1');
    
    RETURN result_text || 'Maintenance completed successfully.';
END;
$ LANGUAGE plpgsql;

-- Create improved updated_at trigger function that's more efficient
CREATE OR REPLACE FUNCTION efficient_update_updated_at_column()
RETURNS TRIGGER AS $
BEGIN
    -- Only update if the updated_at field actually needs updating
    IF OLD.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
        NEW.updated_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Replace existing triggers with more efficient ones
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION efficient_update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at 
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION efficient_update_updated_at_column();

DROP TRIGGER IF EXISTS update_keys_updated_at ON keys;
CREATE TRIGGER update_keys_updated_at 
    BEFORE UPDATE ON keys
    FOR EACH ROW EXECUTE FUNCTION efficient_update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at 
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION efficient_update_updated_at_column();

-- Create indexes for better performance on audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON audit_logs (user_id, action);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at ON login_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_hwid_active ON subscriptions (hwid, is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_keys_redeemed_active ON keys (redeemed_by, is_active) WHERE redeemed_by IS NOT NULL;

-- Create a view for easy subscription monitoring
CREATE OR REPLACE VIEW subscription_monitor AS
SELECT 
    s.id,
    u.email as user_email,
    p.name as product_name,
    s.hwid,
    s.starts_at,
    s.expires_at,
    s.is_active,
    EXTRACT(DAY FROM (s.expires_at - CURRENT_TIMESTAMP)) as days_remaining,
    CASE 
        WHEN s.expires_at <= CURRENT_TIMESTAMP THEN 'EXPIRED'
        WHEN s.expires_at <= CURRENT_TIMESTAMP + INTERVAL '3 days' THEN 'EXPIRING_VERY_SOON'
        WHEN s.expires_at <= CURRENT_TIMESTAMP + INTERVAL '7 days' THEN 'EXPIRING_SOON'
        WHEN s.expires_at <= CURRENT_TIMESTAMP + INTERVAL '30 days' THEN 'EXPIRING_THIS_MONTH'
        ELSE 'ACTIVE'
    END as status,
    k.key_code,
    s.created_at as subscription_created
FROM subscriptions s
JOIN users u ON s.user_id = u.id
JOIN products p ON s.product_id = p.id
JOIN keys k ON s.key_id = k.id
WHERE s.is_active = TRUE
ORDER BY s.expires_at ASC;

-- Create a view for key management overview
CREATE OR REPLACE VIEW key_management_overview AS
SELECT 
    p.name as product_name,
    COUNT(*) as total_keys,
    COUNT(*) FILTER (WHERE k.redeemed_by IS NULL AND k.is_active = TRUE AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP)) as available_keys,
    COUNT(*) FILTER (WHERE k.redeemed_by IS NOT NULL) as redeemed_keys,
    COUNT(*) FILTER (WHERE k.expires_at IS NOT NULL AND k.expires_at <= CURRENT_TIMESTAMP AND k.redeemed_by IS NULL) as expired_unused_keys,
    COUNT(*) FILTER (WHERE k.is_active = FALSE) as inactive_keys,
    ROUND(
        COUNT(*) FILTER (WHERE k.redeemed_by IS NOT NULL)::NUMERIC / 
        NULLIF(COUNT(*), 0) * 100, 2
    ) as redemption_rate_percent
FROM products p
LEFT JOIN keys k ON p.id = k.product_id
WHERE p.is_active = TRUE
GROUP BY p.id, p.name, p.display_order
ORDER BY p.display_order;

-- Final notification
DO $
BEGIN
    RAISE NOTICE '✅ Database triggers and stored procedures created successfully!';
    RAISE NOTICE '📋 Created components:';
    RAISE NOTICE '   - User activity logging triggers';
    RAISE NOTICE '   - Key operations logging triggers';
    RAISE NOTICE '   - Subscription lifecycle management';
    RAISE NOTICE '   - Automated maintenance functions';
    RAISE NOTICE '   - Data integrity checking functions';
    RAISE NOTICE '   - System health monitoring functions';
    RAISE NOTICE '   - Performance monitoring views';
    RAISE NOTICE '   - Enhanced cleanup procedures';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 Available maintenance functions:';
    RAISE NOTICE '   - SELECT schedule_maintenance(); -- Run full maintenance';
    RAISE NOTICE '   - SELECT auto_deactivate_expired_subscriptions(); -- Deactivate expired subs';
    RAISE NOTICE '   - SELECT cleanup_old_audit_logs(90); -- Clean old logs';
    RAISE NOTICE '   - SELECT get_system_health(); -- Check system health';
    RAISE NOTICE '   - SELECT check_data_integrity(); -- Validate data integrity';
END $;