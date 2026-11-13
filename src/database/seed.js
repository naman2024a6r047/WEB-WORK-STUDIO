const bcrypt = require('bcryptjs');
const db = require('./db');

function seedDatabase(force = false) {
  console.log('[Seed] Initializing clean system setup...');

  // Check if users already exist
  const userCount = db.get('SELECT COUNT(*) as count FROM users');
  if (!force && userCount && userCount.count > 0) {
    console.log('[Seed] System already initialized. Skipping.');
    return;
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHashAdmin = bcrypt.hashSync('Admin@123456', salt);
  const passwordHashOps = bcrypt.hashSync('Ops@123456', salt);
  const passwordHashFinance = bcrypt.hashSync('Finance@123456', salt);
  const passwordHashAuditor = bcrypt.hashSync('Audit@123456', salt);

  db.transaction((tx) => {
    // Clear any existing dummy data
    tx.run('DELETE FROM erp_telemetry_history');
    tx.run('DELETE FROM security_events');
    tx.run('DELETE FROM remote_commands');
    tx.run('DELETE FROM payments');
    tx.run('DELETE FROM invoices');
    tx.run('DELETE FROM school_sync_metrics');
    tx.run('DELETE FROM system_notifications');
    tx.run('DELETE FROM audit_logs');
    tx.run('DELETE FROM schools');
    tx.run('DELETE FROM users');
    tx.run('DELETE FROM subscription_plans');
    tx.run('DELETE FROM automation_rules');

    // 1. Insert Administrator Users
    tx.run(
      `INSERT INTO users (id, email, password_hash, full_name, role, mfa_enabled, last_login_at) VALUES 
      ('usr-super-admin', 'admin@centralcommand.io', ?, 'Chief SaaS Executive', 'SUPER_ADMIN', 0, datetime('now')),
      ('usr-ops-mgr', 'ops@centralcommand.io', ?, 'Operations Lead', 'OPERATIONS_MANAGER', 0, datetime('now')),
      ('usr-finance-off', 'finance@centralcommand.io', ?, 'Senior Billing Comptroller', 'FINANCE_OFFICER', 0, datetime('now')),
      ('usr-sec-auditor', 'auditor@centralcommand.io', ?, 'Compliance & Security Auditor', 'AUDITOR', 0, datetime('now'))`,
      passwordHashAdmin, passwordHashOps, passwordHashFinance, passwordHashAuditor
    );

    // 2. Insert Standard Subscription Plans (Clean System Tiers)
    tx.run(
      `INSERT INTO subscription_plans (id, code, name, description, tier_level, monthly_price, annual_price, max_students, max_teachers, max_storage_gb, features_json, modules_json) VALUES 
      ('plan-starter', 'STARTER', 'Starter Campus Edition', 'Ideal for boutique pre-primary and primary schools up to 500 students.', 1, 12000.00, 120000.00, 500, 40, 15, 
        '["Student Directory","Daily Attendance","Fee Billing & Receipts","Parent SMS Notifications","Basic Reports"]',
        '["admissions","attendance","fees","academics"]'
      ),
      ('plan-growth', 'GROWTH', 'Growth Academy Pro', 'Designed for established K-10 and K-12 secondary schools up to 1,500 students.', 2, 25000.00, 250000.00, 1500, 100, 50, 
        '["All Starter Features","Examination & Gradebook","Online Fee Gateway","Library Management","Teacher Payroll","Automated Backups"]',
        '["admissions","attendance","fees","academics","exams","library","payroll"]'
      ),
      ('plan-enterprise', 'ENTERPRISE', 'Enterprise Global Campus', 'Comprehensive multi-branch ERP suite for prestigious institutions up to 3,500 students.', 3, 55000.00, 550000.00, 3500, 250, 150, 
        '["All Growth Features","GPS Bus Tracking","Hostel Management","Inventory & Assets","Custom Report Engine","Priority 24/7 SLA","Dedicated Connector Bridge"]',
        '["admissions","attendance","fees","academics","exams","library","payroll","transport","hostel","inventory","reports"]'
      ),
      ('plan-custom', 'CUSTOM', 'Custom Multi-School Group', 'Bespoke high-scale deployment for educational trusts and mega institutions.', 4, 90000.00, 900000.00, 10000, 800, 500, 
        '["Unlimited Students & Staff","Custom ERP Modules","Dedicated Sync Server","On-premise / Hybrid Database Connector","White-label Custom Domain"]',
        '["admissions","attendance","fees","academics","exams","library","payroll","transport","hostel","inventory","reports","analytics"]'
      )`
    );

    // 3. Insert Automation Rules
    tx.run(
      `INSERT INTO automation_rules (
        id, code, name, description, trigger_type, condition_json, action_type, is_enabled, last_triggered_at
      ) VALUES 
      (
        'rule-pre-expiry-7d', 'RULE_PRE_EXPIRY_NOTIFY', 'Upcoming Subscription Expiry Warning (7 Days)',
        'Automatically dispatches payment reminder notifications to School Owner and Finance dashboard 7 days prior to subscription lapse.',
        'CRON_DAILY', '{"days_before_expiry": 7, "only_unpaid": true}', 'SEND_REMINDER_EMAIL_AND_NOTIF', 1, datetime('now')
      ),
      (
        'rule-overdue-alert', 'RULE_OVERDUE_ALERT', 'Immediate Invoice Overdue Notification',
        'Flags any invoice that passes its due date without full settlement and triggers notification to Central Management.',
        'CRON_DAILY', '{"days_past_due": 1, "balance_gt": 0}', 'CREATE_SYSTEM_NOTIFICATION', 1, datetime('now')
      ),
      (
        'rule-auto-suspend-optin', 'RULE_AUTO_SUSPEND_OPTIN', 'Auto-Suspension for Expired Grace Period (Opt-in Only)',
        'When enabled for a school, automatically enqueues SUSPEND_SERVICE command if payment is delinquent beyond school grace period.',
        'CRON_DAILY', '{"auto_suspend_flag_required": true, "grace_period_exceeded": true}', 'ENQUEUE_REMOTE_SUSPEND_COMMAND', 1, datetime('now')
      ),
      (
        'rule-connector-heartbeat', 'RULE_CONNECTOR_HEARTBEAT_OFFLINE', 'Connector Telemetry Heartbeat Timeout (30 Mins)',
        'Marks school connection health as OFFLINE and raises alert if no telemetry or heartbeat has been received in 30 minutes.',
        'CRON_HOURLY', '{"inactive_minutes": 30}', 'MARK_HEALTH_OFFLINE_AND_ALERT', 1, datetime('now')
      ),
      (
        'rule-24h-student-census', 'RULE_24H_STUDENT_CENSUS_CHECK', '24-Hour Automatic Student Census Reconciliation',
        'Automatically queries latest student enrollment counts every 24 hours and updates dynamic per-student subscription fees.',
        'CRON_24H', '{"interval_hours": 24}', 'RECONCILE_STUDENTS_AND_FEES', 1, datetime('now')
      )`
    );
  });

  console.log('[Seed] Database initialized cleanly with 0 dummy schools and real system tables.');
}

if (require.main === module) {
  seedDatabase(true);
}

module.exports = seedDatabase;
