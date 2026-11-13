-- ============================================================================
-- CENTRAL ERP COMMAND - Database Schema (SQLite / Relational SQL)
-- Multi-School ERP Management & Business Intelligence Platform
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Administrative Users & Roles
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE_OFFICER', 'AUDITOR')),
    mfa_secret TEXT,
    mfa_enabled INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    tier_level INTEGER DEFAULT 1,
    monthly_price REAL NOT NULL,
    annual_price REAL NOT NULL,
    max_students INTEGER DEFAULT 500,
    max_teachers INTEGER DEFAULT 50,
    max_storage_gb INTEGER DEFAULT 10,
    features_json TEXT NOT NULL DEFAULT '[]',
    modules_json TEXT NOT NULL DEFAULT '["admissions","attendance","fees","academics"]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 3. Registered Schools
CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    remote_school_id TEXT,
    data_access_approved INTEGER DEFAULT 1,
    approval_status TEXT DEFAULT 'APPROVED' CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approval_token TEXT,
    approval_requested_at TEXT,
    approved_at TEXT,
    name TEXT NOT NULL,
    logo_url TEXT,
    erp_url TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'India',
    
    -- Contacts
    owner_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    owner_phone TEXT NOT NULL,
    tech_contact_name TEXT,
    tech_contact_email TEXT,
    tech_contact_phone TEXT,
    
    -- Subscription & Commercials
    plan_id TEXT REFERENCES subscription_plans(id),
    billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY')),
    custom_price REAL,
    pricing_model TEXT DEFAULT 'PER_STUDENT' CHECK(pricing_model IN ('FLAT', 'PER_STUDENT')),
    price_per_student REAL DEFAULT 25.0,
    calculated_subscription_amount REAL DEFAULT 0.0,
    last_student_check_at TEXT,
    subscription_start TEXT NOT NULL,
    subscription_end TEXT NOT NULL,
    grace_period_days INTEGER DEFAULT 7,
    auto_suspend_enabled INTEGER DEFAULT 0,
    payment_status TEXT NOT NULL CHECK(payment_status IN ('PAID', 'OVERDUE', 'PENDING', 'GRACE_PERIOD', 'FAILED')),
    
    -- Remote ERP Operational Status
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'SUSPENDED', 'TRIAL', 'PENDING_SETUP')),
    suspension_reason TEXT,
    suspended_at TEXT,
    active_modules_json TEXT NOT NULL DEFAULT '["admissions","attendance","fees","academics","reports"]',
    
    -- Connector & Integration Credentials
    api_key TEXT UNIQUE NOT NULL,
    hmac_secret TEXT NOT NULL,
    ip_whitelist TEXT,
    last_sync_at TEXT,
    last_heartbeat_at TEXT,
    health_status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK(health_status IN ('HEALTHY', 'DEGRADED', 'OFFLINE', 'STALE')),
    
    registration_date TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 4. Invoices (Subscription & Service billing)
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES subscription_plans(id),
    billing_cycle TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    subtotal REAL NOT NULL,
    tax_rate REAL DEFAULT 18.0,
    tax_amount REAL NOT NULL,
    total_amount REAL NOT NULL,
    balance_due REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PAID', 'PENDING', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED')),
    notes TEXT,
    student_count INTEGER DEFAULT 0,
    unit_rate REAL DEFAULT 0.0,
    reminder_sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 5. Payments
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    payment_number TEXT UNIQUE NOT NULL,
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    payment_date TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('BANK_TRANSFER', 'UPI', 'CREDIT_CARD', 'CHEQUE', 'CASH', 'GATEWAY')),
    transaction_reference TEXT UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('SUCCESSFUL', 'PENDING', 'FAILED')),
    recorded_by TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 6. Synchronized ERP School Statistics & Telemetry
CREATE TABLE IF NOT EXISTS school_sync_metrics (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    total_students INTEGER DEFAULT 0,
    active_students INTEGER DEFAULT 0,
    inactive_students INTEGER DEFAULT 0,
    recent_admissions INTEGER DEFAULT 0,
    departed_students INTEGER DEFAULT 0,
    class_distribution_json TEXT DEFAULT '{}',
    
    total_teachers INTEGER DEFAULT 0,
    active_teachers INTEGER DEFAULT 0,
    inactive_teachers INTEGER DEFAULT 0,
    non_teaching_staff INTEGER DEFAULT 0,
    recent_staff_hires INTEGER DEFAULT 0,
    
    attendance_rate_pct REAL DEFAULT 0.0,
    daily_active_logins INTEGER DEFAULT 0,
    storage_used_mb REAL DEFAULT 0.0,
    
    sync_source TEXT DEFAULT 'AUTOMATED_PULL',
    idempotency_key TEXT UNIQUE,
    sync_timestamp TEXT DEFAULT (datetime('now'))
);

-- 7. Predefined Remote Command Queue (Pull-based ERP Control)
CREATE TABLE IF NOT EXISTS remote_commands (
    id TEXT PRIMARY KEY,
    command_id TEXT UNIQUE NOT NULL,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL CHECK(command_type IN ('SUSPEND_SERVICE', 'REACTIVATE_SERVICE', 'EXTEND_SUBSCRIPTION', 'CHANGE_PLAN', 'UPDATE_MODULES', 'SET_GRACE_PERIOD')),
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'EXECUTED', 'FAILED', 'EXPIRED')),
    issued_by TEXT NOT NULL,
    issued_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    executed_at TEXT,
    result_log TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 8. Centralized Security Events (Audit trail across all School ERPs)
CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    user_identifier TEXT,
    ip_address TEXT,
    description TEXT NOT NULL,
    source_erp TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

-- 9. Central Administrative Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details_json TEXT DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 10. Central System Notifications
CREATE TABLE IF NOT EXISTS system_notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
    is_read INTEGER DEFAULT 0,
    action_url TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

-- 11. Configurable Business Automation Rules
CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    remote_school_id TEXT,
    data_access_approved INTEGER DEFAULT 1,
    approval_status TEXT DEFAULT 'APPROVED' CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approval_token TEXT,
    approval_requested_at TEXT,
    approved_at TEXT,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    condition_json TEXT NOT NULL,
    action_type TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    last_triggered_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 12. ERP Telemetry & Performance History
CREATE TABLE IF NOT EXISTS erp_telemetry_history (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    cpu_usage_pct REAL DEFAULT 0.0,
    memory_usage_pct REAL DEFAULT 0.0,
    disk_usage_pct REAL DEFAULT 0.0,
    database_size_mb REAL DEFAULT 0.0,
    response_time_ms INTEGER DEFAULT 0,
    active_sessions INTEGER DEFAULT 0,
    ping_timestamp TEXT DEFAULT (datetime('now'))
);

-- 13. Dispatched Email Communications & Delivery Receipts
CREATE TABLE IF NOT EXISTS email_logs (
    id TEXT PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
    email_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_preview TEXT,
    has_attachment INTEGER DEFAULT 1,
    status TEXT DEFAULT 'SENT',
    sent_at TEXT DEFAULT (datetime('now'))
);

-- Indices for high performance queries
CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(status);
CREATE INDEX IF NOT EXISTS idx_schools_plan ON schools(plan_id);
CREATE INDEX IF NOT EXISTS idx_schools_api_key ON schools(api_key);
CREATE INDEX IF NOT EXISTS idx_invoices_school ON invoices(school_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id);
CREATE INDEX IF NOT EXISTS idx_remote_commands_school_status ON remote_commands(school_id, status);
CREATE INDEX IF NOT EXISTS idx_security_events_school ON security_events(school_id);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_school_metrics_school ON school_sync_metrics(school_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON system_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id);
