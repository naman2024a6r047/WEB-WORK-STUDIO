const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config/config');

// Ensure database directory exists
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(config.DB_PATH);

// Enable foreign keys and WAL mode for reliability, concurrency, and durability
db.exec('PRAGMA foreign_keys = ON;');
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
} catch (e) {
  // Ignore in restricted environments
}

// Initialize schema
function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  // Auto-migrate new columns if missing
  try {
    const columns = db.prepare('PRAGMA table_info(schools)').all().map(c => c.name);
    if (!columns.includes('pricing_model')) {
      db.exec("ALTER TABLE schools ADD COLUMN pricing_model TEXT DEFAULT 'PER_STUDENT';");
    }
    if (!columns.includes('price_per_student')) {
      db.exec("ALTER TABLE schools ADD COLUMN price_per_student REAL DEFAULT 25.0;");
    }
    if (!columns.includes('calculated_subscription_amount')) {
      db.exec("ALTER TABLE schools ADD COLUMN calculated_subscription_amount REAL DEFAULT 0.0;");
    }
    if (!columns.includes('last_student_check_at')) {
      db.exec("ALTER TABLE schools ADD COLUMN last_student_check_at TEXT;");
    }
    if (!columns.includes('remote_school_id')) {
      db.exec("ALTER TABLE schools ADD COLUMN remote_school_id TEXT;");
    }
    if (!columns.includes('data_access_approved')) {
      db.exec("ALTER TABLE schools ADD COLUMN data_access_approved INTEGER DEFAULT 1;");
    }
    if (!columns.includes('approval_status')) {
      db.exec("ALTER TABLE schools ADD COLUMN approval_status TEXT DEFAULT 'APPROVED';");
    }
    if (!columns.includes('approval_token')) {
      db.exec("ALTER TABLE schools ADD COLUMN approval_token TEXT;");
    }
    if (!columns.includes('approval_requested_at')) {
      db.exec("ALTER TABLE schools ADD COLUMN approval_requested_at TEXT;");
    }
    if (!columns.includes('approved_at')) {
      db.exec("ALTER TABLE schools ADD COLUMN approved_at TEXT;");
    }

    // Auto-migrate invoice columns for student census tracking
    const invoiceCols = db.prepare('PRAGMA table_info(invoices)').all().map(c => c.name);
    if (!invoiceCols.includes('student_count')) {
      db.exec("ALTER TABLE invoices ADD COLUMN student_count INTEGER DEFAULT 0;");
    }
    if (!invoiceCols.includes('unit_rate')) {
      db.exec("ALTER TABLE invoices ADD COLUMN unit_rate REAL DEFAULT 0.0;");
    }

    // Ensure email_logs table exists
    db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id);
    `);

    // Ensure 24h census reconciliation automation rule exists
    const existingRule = db.prepare("SELECT id FROM automation_rules WHERE code = 'RULE_24H_STUDENT_CENSUS_CHECK'").get();
    if (!existingRule) {
      db.prepare(`
        INSERT INTO automation_rules (
          id, code, name, description, trigger_type, condition_json, action_type, is_enabled, last_triggered_at
        ) VALUES (
          'rule-24h-student-census', 'RULE_24H_STUDENT_CENSUS_CHECK', '24-Hour Automatic Student Census Reconciliation',
          'Automatically queries latest student enrollment counts every 24 hours and updates dynamic per-student subscription fees.',
          'CRON_24H', '{"interval_hours": 24}', 'RECONCILE_STUDENTS_AND_FEES', 1, datetime('now', '-25 hours')
        )
      `).run();
    }
  } catch (err) {
    console.error('[DB Column Migration Warning]', err.message);
  }

  // Ensure schools and records are restored from permanent registry if empty
  try {
    const persistenceManager = require('./persistenceManager');
    persistenceManager.restoreFromPermanentRegistryIfEmpty(dbHelper);
  } catch (err) {
    console.error('[Persistence Manager Startup Notice]', err.message);
  }
}

// Database helper functions
const dbHelper = {
  getRawDb: () => db,

  initSchema: () => initSchema(),

  savePermanentSnapshot: () => {
    try {
      const persistenceManager = require('./persistenceManager');
      return persistenceManager.savePersistentSnapshot(dbHelper);
    } catch (e) {
      return { saved: false, error: e.message };
    }
  },

  all: (sql, ...params) => {
    try {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    } catch (err) {
      console.error(`[DB Error in .all] SQL: ${sql}`, err);
      throw err;
    }
  },

  get: (sql, ...params) => {
    try {
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    } catch (err) {
      console.error(`[DB Error in .get] SQL: ${sql}`, err);
      throw err;
    }
  },

  run: (sql, ...params) => {
    try {
      const stmt = db.prepare(sql);
      return stmt.run(...params);
    } catch (err) {
      console.error(`[DB Error in .run] SQL: ${sql}`, err);
      throw err;
    }
  },

  exec: (sql) => {
    return db.exec(sql);
  },

  transaction: (fn) => {
    db.exec('BEGIN TRANSACTION');
    try {
      const result = fn(dbHelper);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
};

initSchema();

module.exports = dbHelper;
