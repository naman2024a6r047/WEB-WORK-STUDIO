const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 4000,
  NODE_ENV: process.env.NODE_ENV || 'production',
  JWT_SECRET: process.env.JWT_SECRET || 'central-erp-super-secret-jwt-key-992182749',
  JWT_EXPIRES_IN: '12h',

  // Database Connection: Hostinger MySQL / MariaDB or Local SQLite
  DB_CLIENT: process.env.DB_CLIENT || (process.env.DB_HOST ? 'mysql' : 'sqlite'),
  DB_HOST: process.env.DB_HOST || '',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),
  DB_NAME: process.env.DB_NAME || '',
  DB_USER: process.env.DB_USER || '',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_SSL: process.env.DB_SSL === 'true',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../../data/central_erp.sqlite'),

  REPLAY_WINDOW_SECONDS: 300, // 5 minutes max clock drift
  DEFAULT_GRACE_PERIOD_DAYS: 7,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: 120,
};
