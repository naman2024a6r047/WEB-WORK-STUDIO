-- ============================================================================
-- CENTRAL ERP COMMAND - HOSTINGER MYSQL / MARIADB DATABASE SCHEMA
-- Compatible with MySQL 8.0+, MariaDB 10.5+, and Hostinger Cloud/cPanel
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Users & RBAC
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(64) NOT NULL,
    mfa_secret VARCHAR(255) NULL,
    mfa_enabled TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Commercial Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tier_code VARCHAR(64) UNIQUE NOT NULL,
    monthly_price DECIMAL(12,2) NOT NULL,
    annual_price DECIMAL(12,2) NOT NULL,
    max_students INT DEFAULT 0,
    features_json TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Schools (Multi-Tenant Managed Client Instances)
CREATE TABLE IF NOT EXISTS schools (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    remote_school_id VARCHAR(64) NULL,
    data_access_approved TINYINT(1) DEFAULT 1,
    approval_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'APPROVED',
    approval_token VARCHAR(255) NULL,
    approval_requested_at DATETIME NULL,
    approved_at DATETIME NULL,
    logo_url VARCHAR(500) NULL,
    erp_url VARCHAR(500) NOT NULL,
    address TEXT NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    country VARCHAR(100) DEFAULT 'India',
    
    owner_name VARCHAR(255) NOT NULL,
    owner_email VARCHAR(255) NOT NULL,
    owner_phone VARCHAR(50) NOT NULL,
    tech_contact_name VARCHAR(255) NULL,
    tech_contact_email VARCHAR(255) NULL,
    tech_contact_phone VARCHAR(50) NULL,
    
    plan_id VARCHAR(64) NULL,
    billing_cycle ENUM('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY') DEFAULT 'MONTHLY',
    custom_price DECIMAL(12,2) NULL,
    pricing_model ENUM('PER_STUDENT', 'FLAT') DEFAULT 'PER_STUDENT',
    price_per_student DECIMAL(8,2) DEFAULT 25.00,
    calculated_subscription_amount DECIMAL(12,2) DEFAULT 0.00,
    latest_student_count INT DEFAULT 0,
    last_student_check_at DATETIME NULL,
    
    subscription_start DATE NOT NULL,
    subscription_end DATE NOT NULL,
    grace_period_days INT DEFAULT 7,
    auto_suspend_enabled TINYINT(1) DEFAULT 0,
    
    payment_status ENUM('PAID', 'PENDING', 'OVERDUE') DEFAULT 'PAID',
    status ENUM('ACTIVE', 'SUSPENDED', 'TRIAL', 'DECOMMISSIONED') DEFAULT 'ACTIVE',
    suspended_at DATETIME NULL,
    suspension_reason TEXT NULL,
    
    active_modules_json TEXT,
    api_key VARCHAR(128) UNIQUE NOT NULL,
    hmac_secret VARCHAR(255) NOT NULL,
    last_nonce VARCHAR(128) NULL,
    last_sync_at DATETIME NULL,
    health_status ENUM('HEALTHY', 'STALE', 'OFFLINE', 'TAMPER_ALERT') DEFAULT 'HEALTHY',
    registration_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(64) PRIMARY KEY,
    invoice_number VARCHAR(64) UNIQUE NOT NULL,
    school_id VARCHAR(64) NOT NULL,
    plan_id VARCHAR(64) NULL,
    billing_cycle VARCHAR(32) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_rate DECIMAL(5,2) DEFAULT 18.00,
    tax_amount DECIMAL(12,2) NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    balance_due DECIMAL(12,2) NOT NULL,
    status ENUM('PAID', 'PENDING', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED') NOT NULL,
    notes TEXT NULL,
    reminder_sent_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Payments
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    payment_number VARCHAR(64) UNIQUE NOT NULL,
    invoice_id VARCHAR(64) NULL,
    school_id VARCHAR(64) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method ENUM('BANK_TRANSFER', 'UPI', 'CREDIT_CARD', 'CHEQUE', 'CASH', 'GATEWAY') NOT NULL,
    transaction_reference VARCHAR(128) UNIQUE NULL,
    status ENUM('SUCCESSFUL', 'PENDING', 'FAILED') NOT NULL,
    recorded_by VARCHAR(64) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Synchronized ERP School Statistics & Telemetry
CREATE TABLE IF NOT EXISTS school_sync_metrics (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL,
    total_students INT DEFAULT 0,
    active_students INT DEFAULT 0,
    inactive_students INT DEFAULT 0,
    recent_admissions INT DEFAULT 0,
    departed_students INT DEFAULT 0,
    class_distribution_json TEXT,
    
    total_teachers INT DEFAULT 0,
    active_teachers INT DEFAULT 0,
    inactive_teachers INT DEFAULT 0,
    non_teaching_staff INT DEFAULT 0,
    recent_staff_hires INT DEFAULT 0,
    
    attendance_rate_pct DECIMAL(5,2) DEFAULT 0.00,
    daily_active_logins INT DEFAULT 0,
    storage_used_mb DECIMAL(10,2) DEFAULT 0.00,
    
    sync_source VARCHAR(64) DEFAULT 'AUTOMATED_PULL',
    idempotency_key VARCHAR(128) UNIQUE NULL,
    sync_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Remote Command Queue
CREATE TABLE IF NOT EXISTS remote_commands (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL,
    command_type ENUM('SUSPEND_SERVICE', 'REACTIVATE_SERVICE', 'FORCE_TELEMETRY_SYNC', 'ROTATE_SECURITY_KEYS', 'PURGE_STALE_SESSIONS') NOT NULL,
    payload_json TEXT NOT NULL,
    status ENUM('PENDING', 'DISPATCHED', 'ACKNOWLEDGED', 'EXECUTED', 'FAILED', 'TIMED_OUT') DEFAULT 'PENDING',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 5,
    issued_by VARCHAR(64) NOT NULL,
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME NULL,
    executed_at DATETIME NULL,
    execution_result_json TEXT NULL,
    idempotency_token VARCHAR(128) UNIQUE NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Security Events & HMAC Integrity Logs
CREATE TABLE IF NOT EXISTS security_events (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NULL,
    event_type ENUM('INVALID_HMAC_SIGNATURE', 'REPLAY_ATTACK_DETECTED', 'NONCE_REUSE_DETECTED', 'CLOCK_DRIFT_EXCEEDED', 'UNAUTHORIZED_IP', 'SUSPICIOUS_PAYLOAD') NOT NULL,
    severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    request_ip VARCHAR(64) NULL,
    request_endpoint VARCHAR(255) NULL,
    raw_payload_hash VARCHAR(128) NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Central Operator Audit Trail
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NULL,
    user_email VARCHAR(255) NOT NULL,
    action VARCHAR(128) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(64) NULL,
    details_json TEXT,
    ip_address VARCHAR(64) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. System Notifications
CREATE TABLE IF NOT EXISTS system_notifications (
    id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL') NOT NULL,
    school_id VARCHAR(64) NULL,
    is_read TINYINT(1) DEFAULT 0,
    action_url VARCHAR(255) NULL,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Automation Rules
CREATE TABLE IF NOT EXISTS automation_rules (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    trigger_type VARCHAR(64) NOT NULL,
    condition_json TEXT NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    is_enabled TINYINT(1) DEFAULT 1,
    last_triggered_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. ERP Telemetry History
CREATE TABLE IF NOT EXISTS erp_telemetry_history (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL,
    cpu_usage_pct DECIMAL(5,2) DEFAULT 0.00,
    memory_usage_pct DECIMAL(5,2) DEFAULT 0.00,
    disk_usage_pct DECIMAL(5,2) DEFAULT 0.00,
    database_size_mb DECIMAL(10,2) DEFAULT 0.00,
    response_time_ms INT DEFAULT 0,
    active_sessions INT DEFAULT 0,
    ping_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Email Communication Logs
CREATE TABLE IF NOT EXISTS email_logs (
    id VARCHAR(64) PRIMARY KEY,
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255) NULL,
    school_id VARCHAR(64) NULL,
    invoice_id VARCHAR(64) NULL,
    payment_id VARCHAR(64) NULL,
    email_type VARCHAR(64) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_preview TEXT NULL,
    has_attachment TINYINT(1) DEFAULT 1,
    status VARCHAR(32) DEFAULT 'SENT',
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
