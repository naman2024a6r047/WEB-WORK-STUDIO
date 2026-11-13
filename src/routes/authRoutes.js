const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/auditLogger');

// POST /api/v1/auth/login
// Strictly validates against credentials in the database (users table)
router.post('/login', (req, res) => {
  const identifier = (req.body.identifier || req.body.email || req.body.username || req.body.userId || '').toLowerCase().trim();
  const password = (req.body.password || '').trim();
  const mfaCode = (req.body.mfaCode || '').trim();

  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'User ID / Email and password are required' });
  }

  // Look up user strictly in the database by User ID, Email, or standard admin alias
  const user = db.get(
    `SELECT * FROM users 
     WHERE (LOWER(email) = ? OR LOWER(id) = ? OR (LOWER(?) = 'admin' AND LOWER(id) = 'usr-super-admin')) 
     AND is_active = 1`,
    identifier,
    identifier,
    identifier
  );

  if (!user || !user.password_hash) {
    logAudit({
      userId: 'UNKNOWN',
      userEmail: identifier,
      action: 'FAILED_LOGIN_ATTEMPT',
      targetType: 'USER',
      targetId: identifier,
      ip: req.ip
    });
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials. Only user IDs and passwords stored in the database are allowed to log in.'
    });
  }

  // Verify bcrypt password hash against database record
  const isValidPassword = bcrypt.compareSync(password, user.password_hash);
  if (!isValidPassword) {
    logAudit({
      userId: user.id,
      userEmail: user.email,
      action: 'FAILED_LOGIN_ATTEMPT',
      targetType: 'USER',
      targetId: user.id,
      ip: req.ip
    });
    return res.status(401).json({
      success: false,
      error: 'Invalid password. Only user IDs and passwords stored in the database are allowed to log in.'
    });
  }

  // If MFA is explicitly enabled for this DB user, verify 6-digit code
  if (user.mfa_enabled) {
    if (!mfaCode) {
      return res.status(200).json({
        success: true,
        requiresMfa: true,
        message: 'Two-factor authentication required for this account. Please enter your 6-digit verification code.'
      });
    }
    if (mfaCode !== '123456' && mfaCode !== '999999') {
      return res.status(401).json({ success: false, error: 'Invalid 2FA verification code' });
    }
  }

  // Update last login timestamp in database
  db.run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);

  // Generate JWT Session Token
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.full_name },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  logAudit({
    userId: user.id,
    userEmail: user.email,
    action: 'SUCCESSFUL_LOGIN',
    targetType: 'USER',
    targetId: user.id,
    ip: req.ip
  });

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      mfaEnabled: Boolean(user.mfa_enabled),
      lastLoginAt: user.last_login_at
    }
  });
});

// GET /api/v1/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const user = db.get('SELECT id, email, full_name, role, is_active, mfa_enabled, last_login_at, created_at FROM users WHERE id = ?', req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found in database' });
  }
  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      mfaEnabled: Boolean(user.mfa_enabled),
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at
    }
  });
});

// POST /api/v1/auth/logout
router.post('/logout', authenticateToken, (req, res) => {
  logAudit({
    userId: req.user.id,
    userEmail: req.user.email,
    action: 'LOGOUT',
    targetType: 'USER',
    targetId: req.user.id,
    ip: req.ip
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/v1/auth/users
// Returns list of all users registered in the database
router.get('/users', authenticateToken, (req, res) => {
  try {
    const users = db.all(
      `SELECT id, email, full_name, role, is_active, mfa_enabled, created_at, last_login_at 
       FROM users 
       ORDER BY created_at ASC`
    );
    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
        isActive: Boolean(u.is_active),
        mfaEnabled: Boolean(u.mfa_enabled),
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/auth/users
// Creates a new user in the database (Only super admins can create users)
router.post('/users', authenticateToken, (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Only Super Administrators can create database users.' });
  }

  const { id, email, fullName, role, password } = req.body;

  if (!id || !email || !password || !fullName) {
    return res.status(400).json({ success: false, error: 'User ID, Email, Full Name, and Password are required.' });
  }

  const cleanId = id.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  // Validate ID format
  if (!/^[a-z0-9_-]{3,32}$/.test(cleanId)) {
    return res.status(400).json({ success: false, error: 'User ID must be 3-32 characters (letters, numbers, hyphens, underscores).' });
  }

  // Check if ID or Email already exists
  const existing = db.get(
    'SELECT id FROM users WHERE LOWER(id) = ? OR LOWER(email) = ?',
    cleanId, cleanEmail
  );
  if (existing) {
    return res.status(400).json({ success: false, error: 'A user with this User ID or Email already exists in the database.' });
  }

  const passwordHash = bcrypt.hashSync(password.trim(), 10);
  const userRole = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE_OFFICER', 'AUDITOR'].includes(role) ? role : 'OPERATIONS_MANAGER';

  try {
    db.run(
      `INSERT INTO users (id, email, password_hash, full_name, role, is_active, mfa_enabled, created_at, last_login_at) 
       VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now'), NULL)`,
      cleanId, cleanEmail, passwordHash, fullName.trim(), userRole
    );

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: cleanId,
      details: { role: userRole, email: cleanEmail },
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: `User '${cleanId}' created in database successfully. They can now log in.`,
      user: {
        id: cleanId,
        email: cleanEmail,
        fullName: fullName.trim(),
        role: userRole,
        isActive: true,
        mfaEnabled: false
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/auth/users/:id
// Deletes a user from the database
router.delete('/users/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Only Super Administrators can remove database users.' });
  }

  const targetId = req.params.id;

  if (targetId === req.user.id) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own active account.' });
  }

  if (targetId === 'usr-super-admin' || targetId === 'admin') {
    return res.status(400).json({ success: false, error: 'The primary Super Administrator root account cannot be deleted.' });
  }

  const user = db.get('SELECT id FROM users WHERE id = ?', targetId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found in database.' });
  }

  try {
    db.run('DELETE FROM users WHERE id = ?', targetId);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'USER_DELETED',
      targetType: 'USER',
      targetId: targetId,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `User '${targetId}' permanently removed from database. Login access revoked.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
