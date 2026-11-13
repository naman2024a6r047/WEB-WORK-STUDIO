const fs = require('fs');
const path = require('path');

class PersistenceManager {
  constructor() {
    this.storageDir = path.join(__dirname, '../../data/permanent_storage');
    this.registryFile = path.join(this.storageDir, 'schools_registry.json');
  }

  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Save an atomic, permanent snapshot of all schools, sync metrics, invoices, and payments.
   */
  savePersistentSnapshot(dbHelper) {
    try {
      this.ensureStorageDir();

      const schools = dbHelper.all('SELECT * FROM schools');
      if (!schools || schools.length === 0) {
        return { saved: false, reason: 'No schools in database to snapshot' };
      }

      const metrics = dbHelper.all('SELECT * FROM school_sync_metrics');
      const invoices = dbHelper.all('SELECT * FROM invoices');
      const payments = dbHelper.all('SELECT * FROM payments');
      const commands = dbHelper.all('SELECT * FROM remote_commands ORDER BY issued_at DESC LIMIT 500');

      const snapshot = {
        version: '1.0.0',
        savedAt: new Date().toISOString(),
        totalSchools: schools.length,
        schools,
        school_sync_metrics: metrics,
        invoices,
        payments,
        remote_commands: commands
      };

      // Atomic write using temporary file to prevent corruption on crash
      const tempFile = `${this.registryFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, JSON.stringify(snapshot, null, 2), 'utf8');
      fs.renameSync(tempFile, this.registryFile);

      return { saved: true, schoolCount: schools.length, timestamp: snapshot.savedAt };
    } catch (err) {
      console.error('[Persistence Manager] Failed to save persistent snapshot:', err.message);
      return { saved: false, error: err.message };
    }
  }

  /**
   * Automatically restore schools and data from permanent storage if the database is empty.
   */
  restoreFromPermanentRegistryIfEmpty(dbHelper) {
    try {
      const countRes = dbHelper.get('SELECT COUNT(*) as count FROM schools');
      const currentCount = countRes ? countRes.count : 0;

      if (currentCount > 0) {
        // Database already has schools, immediately ensure persistent snapshot is up to date
        this.savePersistentSnapshot(dbHelper);
        return { restored: false, reason: `Database already contains ${currentCount} schools` };
      }

      if (!fs.existsSync(this.registryFile)) {
        return { restored: false, reason: 'No persistent registry file found' };
      }

      const raw = fs.readFileSync(this.registryFile, 'utf8');
      const snapshot = JSON.parse(raw);

      if (!snapshot.schools || snapshot.schools.length === 0) {
        return { restored: false, reason: 'Persistent snapshot contains no schools' };
      }

      console.log(`[Persistence Manager] Recovering ${snapshot.schools.length} schools from permanent storage...`);

      dbHelper.transaction((tx) => {
        // 1. Restore Schools
        for (const s of snapshot.schools) {
          const keys = Object.keys(s);
          const values = Object.values(s);
          const placeholders = keys.map(() => '?').join(', ');
          tx.run(`INSERT OR IGNORE INTO schools (${keys.join(', ')}) VALUES (${placeholders})`, ...values);
        }

        // 2. Restore Sync Metrics
        if (Array.isArray(snapshot.school_sync_metrics)) {
          for (const m of snapshot.school_sync_metrics) {
            const keys = Object.keys(m);
            const values = Object.values(m);
            const placeholders = keys.map(() => '?').join(', ');
            tx.run(`INSERT OR IGNORE INTO school_sync_metrics (${keys.join(', ')}) VALUES (${placeholders})`, ...values);
          }
        }

        // 3. Restore Invoices
        if (Array.isArray(snapshot.invoices)) {
          for (const inv of snapshot.invoices) {
            const keys = Object.keys(inv);
            const values = Object.values(inv);
            const placeholders = keys.map(() => '?').join(', ');
            tx.run(`INSERT OR IGNORE INTO invoices (${keys.join(', ')}) VALUES (${placeholders})`, ...values);
          }
        }

        // 4. Restore Payments
        if (Array.isArray(snapshot.payments)) {
          for (const p of snapshot.payments) {
            const keys = Object.keys(p);
            const values = Object.values(p);
            const placeholders = keys.map(() => '?').join(', ');
            tx.run(`INSERT OR IGNORE INTO payments (${keys.join(', ')}) VALUES (${placeholders})`, ...values);
          }
        }

        // 5. Restore Remote Commands
        if (Array.isArray(snapshot.remote_commands)) {
          for (const cmd of snapshot.remote_commands) {
            const keys = Object.keys(cmd);
            const values = Object.values(cmd);
            const placeholders = keys.map(() => '?').join(', ');
            tx.run(`INSERT OR IGNORE INTO remote_commands (${keys.join(', ')}) VALUES (${placeholders})`, ...values);
          }
        }
      });

      console.log(`[Persistence Manager] ✓ Successfully restored ${snapshot.schools.length} schools and records from permanent storage.`);
      return { restored: true, schoolCount: snapshot.schools.length };
    } catch (err) {
      console.error('[Persistence Manager] Recovery error:', err.message);
      return { restored: false, error: err.message };
    }
  }
}

module.exports = new PersistenceManager();
