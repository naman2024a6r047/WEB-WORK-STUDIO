require('dotenv').config();
const hostingerDb = require('./hostingerDb');
const sqliteDb = require('./db');
const config = require('../config/config');

async function main() {
  console.log('================================================================');
  console.log('  CENTRAL ERP COMMAND — HOSTINGER DATABASE MIGRATION UTILITY');
  console.log('================================================================');

  if (!config.DB_HOST || !config.DB_NAME || !config.DB_USER) {
    console.error('\n❌ ERROR: Hostinger Database connection parameters missing in .env!\n');
    console.log('Please add your Hostinger MySQL details to your .env file:');
    console.log('----------------------------------------------------------------');
    console.log('DB_CLIENT=mysql');
    console.log('DB_HOST=sqlXXX.hostinger.com    # Or your server IP / domain');
    console.log('DB_PORT=3306');
    console.log('DB_NAME=u123456789_erp_db');
    console.log('DB_USER=u123456789_admin');
    console.log('DB_PASSWORD=your_hostinger_db_password');
    console.log('----------------------------------------------------------------');
    console.log('\nTIP: In Hostinger hPanel -> Databases -> Remote MySQL:');
    console.log('Ensure you have allowed remote connections from your IP (or "%" for anywhere).\n');
    process.exit(1);
  }

  console.log(`Connecting to Hostinger DB at: ${config.DB_HOST}:${config.DB_PORT}...`);
  console.log(`Database Name: ${config.DB_NAME}`);
  console.log(`User: ${config.DB_USER}\n`);

  try {
    const connInfo = await hostingerDb.testConnection();
    console.log('✓ Successfully connected to Hostinger MySQL Server!');
    console.log(`  MySQL Server Version: ${connInfo.mysql_version}`);
    console.log(`  Server Time: ${connInfo.server_time}\n`);

    console.log('1. Deploying MySQL tables to Hostinger...');
    await hostingerDb.deploySchema();

    console.log('2. Migrating all users, schools, invoices, and metrics to Hostinger...');
    const migrationResults = await hostingerDb.migrateFromLocalSqlite(sqliteDb);

    console.log('\n================================================================');
    console.log('  MIGRATION SUMMARY');
    console.log('================================================================');
    for (const [table, count] of Object.entries(migrationResults)) {
      console.log(`  • ${table.padEnd(25)}: ${count} rows synced`);
    }

    console.log('\n🎉 ALL DATA & USERS SUCCESSFULLY MIGRATED TO HOSTINGER DATABASE!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Hostinger Migration Failed:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\nHint: Check your Hostinger DB username and password.');
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      console.error('\nHint: Ensure "Remote MySQL" is enabled in Hostinger hPanel with IP "%" (Any Host).');
    }
    process.exit(1);
  }
}

main();
