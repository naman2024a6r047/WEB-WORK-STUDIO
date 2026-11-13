/**
 * CENTRAL ERP COMMAND - Main Application Entrypoint
 * Required by cloud deployment platforms (Hostinger, Render, Railway, DigitalOcean, Heroku)
 */
require('dotenv').config();
const path = require('path');
const config = require('./src/config/config');
const db = require('./src/database/db');
const seedDatabase = require('./src/database/seed');

// Initialize database schema and ensure default admin user is seeded
try {
  if (typeof db.initSchema === 'function') {
    db.initSchema();
  }
  seedDatabase();
} catch (err) {
  console.warn('[DB Init Warning]', err.message);
}

// Import Express application
const app = require('./src/server');

// Resolve port from environment or config
const PORT = process.env.PORT || config.PORT || 4000;

// Start HTTP server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log('  CENTRAL ERP COMMAND - Multi-School SaaS Management & BI Engine');
  console.log(`  Live at: http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`  Database Engine: ${process.env.HOSTINGER_DB_HOST ? 'Hostinger MySQL / MariaDB' : 'Embedded SQLite'}`);
  console.log('================================================================');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('[System] Received SIGTERM. Shutting down gracefully...');
  try {
    db.savePermanentSnapshot();
  } catch (e) {}
  server.close(() => {
    console.log('[System] HTTP server closed.');
    process.exit(0);
  });
});

module.exports = server;
