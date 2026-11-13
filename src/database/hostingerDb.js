const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

class HostingerDbService {
  constructor() {
    this.pool = null;
  }

  getPool() {
    if (!this.pool) {
      if (!config.DB_HOST || !config.DB_NAME || !config.DB_USER) {
        throw new Error('Hostinger DB parameters (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) are not fully configured in .env');
      }

      this.pool = mysql.createPool({
        host: config.DB_HOST,
        port: config.DB_PORT || 3306,
        user: config.DB_USER,
        password: config.DB_PASSWORD,
        database: config.DB_NAME,
        waitForConnections: true,
        connectionLimit: 15,
        queueLimit: 0,
        ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined
      });
    }
    return this.pool;
  }

  /**
   * Test connection to Hostinger MySQL
   */
  async testConnection() {
    const pool = this.getPool();
    const [rows] = await pool.query('SELECT 1 as connected, NOW() as server_time, VERSION() as mysql_version');
    return rows[0];
  }

  /**
   * Run schema migration on Hostinger MySQL
   */
  async deploySchema() {
    const pool = this.getPool();
    const schemaPath = path.join(__dirname, 'schema.mysql.sql');
    const rawSql = fs.readFileSync(schemaPath, 'utf8');

    // Split statements safely
    const statements = rawSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`[Hostinger DB] Deploying ${statements.length} table definitions...`);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err) {
        console.error(`[Hostinger DB Error in Statement] ${stmt.slice(0, 60)}...`, err.message);
        throw err;
      }
    }
    console.log('✓ Hostinger MySQL Schema deployed successfully.');
    return { success: true, statementsExecuted: statements.length };
  }

  /**
   * Export all existing SQLite data to Hostinger MySQL
   */
  async migrateFromLocalSqlite(sqliteDb) {
    const pool = this.getPool();
    await this.deploySchema();

    const tables = [
      'users',
      'subscription_plans',
      'schools',
      'invoices',
      'payments',
      'school_sync_metrics',
      'remote_commands',
      'security_events',
      'audit_logs',
      'system_notifications',
      'automation_rules',
      'erp_telemetry_history',
      'email_logs'
    ];

    const results = {};

    for (const table of tables) {
      try {
        const rows = sqliteDb.all(`SELECT * FROM ${table}`);
        if (rows.length === 0) {
          results[table] = 0;
          continue;
        }

        console.log(`[Hostinger DB] Migrating ${rows.length} rows for table: ${table}...`);
        for (const row of rows) {
          const keys = Object.keys(row);
          const values = Object.values(row);
          const placeholders = keys.map(() => '?').join(', ');
          const updateAssignments = keys.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');

          const query = `
            INSERT INTO \`${table}\` (\`${keys.join('`, `')}\`)
            VALUES (${placeholders})
            ON DUPLICATE KEY UPDATE ${updateAssignments}
          `;

          await pool.query(query, values);
        }
        results[table] = rows.length;
      } catch (err) {
        console.warn(`[Hostinger Migration Notice for ${table}]`, err.message);
        results[table] = `Error: ${err.message}`;
      }
    }

    return results;
  }
}

module.exports = new HostingerDbService();
