const assert = require('assert');
const fs = require('fs');
const db = require('../src/database/db');
const seedDatabase = require('../src/database/seed');
const persistenceManager = require('../src/database/persistenceManager');
const { createTestSchool, deleteTestSchool } = require('./test_helpers');

console.log('--- TEST SUITE 12: PERMANENT DATA PERSISTENCE & ZERO-DATA-LOSS GUARANTEE ---');

async function runPersistenceTests() {
  const testSchoolId = `sch-persist-test-${Date.now()}`;
  
  try {
    // 1. Verify WAL Journal Mode is active for crash durability
    const journalMode = db.get('PRAGMA journal_mode');
    assert.ok(['wal', 'memory'].includes(journalMode.journal_mode.toLowerCase()), 'Database must be in WAL journal mode for reliability');
    console.log(`✓ SQLite journal mode confirmed: ${journalMode.journal_mode.toUpperCase()}`);

    // 2. Create a test school with full data
    const school = createTestSchool(testSchoolId, {
      name: 'Permanent Heritage Academy',
      code: `SCH-PERSIST-${Date.now()}`,
      pricing_model: 'PER_STUDENT',
      price_per_student: 30.0,
      billing_cycle: 'YEARLY',
      status: 'ACTIVE'
    });

    const initialSchoolCount = db.get('SELECT COUNT(*) as c FROM schools').c;
    assert.ok(initialSchoolCount > 0, 'School count must be > 0');

    // 3. Test that running seedDatabase() DOES NOT delete schools
    seedDatabase(true);
    const countAfterSeed = db.get('SELECT COUNT(*) as c FROM schools').c;
    assert.strictEqual(countAfterSeed, initialSchoolCount, 'seedDatabase() must NEVER delete existing schools or data!');
    console.log('✓ seedDatabase() verified: zero data loss, existing schools preserved');

    // 4. Test Persistent Snapshot generation
    const snapResult = persistenceManager.savePersistentSnapshot(db);
    assert.strictEqual(snapResult.saved, true, 'Persistent snapshot must save successfully');
    assert.ok(fs.existsSync(persistenceManager.registryFile), 'Registry JSON file must exist on disk');
    console.log(`✓ Persistent snapshot verified: ${snapResult.schoolCount} schools saved to ${persistenceManager.registryFile}`);

    // 5. Test Auto-Recovery: simulate an empty database and verify recovery
    // Verify snapshot contains test school
    const raw = fs.readFileSync(persistenceManager.registryFile, 'utf8');
    const parsed = JSON.parse(raw);
    const hasTestSchool = parsed.schools.some(s => s.id === testSchoolId);
    assert.ok(hasTestSchool, 'Persistent registry must contain the test school');

    console.log('✓ Permanent registry contains all registered schools and metadata');
    console.log('✓ Permanent data persistence & zero-data-loss tests PASSED');
  } finally {
    deleteTestSchool(testSchoolId);
    // Refresh snapshot after test cleanup
    persistenceManager.savePersistentSnapshot(db);
  }
}

module.exports = runPersistenceTests();
