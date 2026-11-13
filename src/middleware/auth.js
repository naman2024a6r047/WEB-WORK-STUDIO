const jwt = require('jsonwebtoken');
const config = require('../config/config');
const db = require('../database/db');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Allow token query parameter for direct browser PDF streaming / downloads
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication token required' });
  }

  jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired authentication token' });
    }

    // Verify user is still active in database
    const user = db.get('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?', decoded.id);
    if (!user || !user.is_active) {
      return res.status(403).json({ success: false, error: 'User account is deactivated or does not exist' });
    }

    req.user = user;
    next();
  });
}

function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (roles.length && !roles.includes(req.user.role) && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. Requires one of roles: [${roles.join(', ')}]` 
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole,
};
