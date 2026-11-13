const crypto = require('crypto');
const db = require('../database/db');
const { logAudit } = require('../middleware/auditLogger');

const VALID_COMMANDS = [
  'SUSPEND_SERVICE',
  'REACTIVATE_SERVICE',
  'EXTEND_SUBSCRIPTION',
  'CHANGE_PLAN',
  'UPDATE_MODULES',
  'SET_GRACE_PERIOD'
];

class CommandQueueService {
  /**
   * Enqueue a predefined remote command for an ERP connector to poll
   */
  enqueueCommand({ schoolId, commandType, payload = {}, issuedBy = 'usr-super-admin', expiresHours = 24 }) {
    if (!VALID_COMMANDS.includes(commandType)) {
      throw new Error(`Invalid command type: ${commandType}. Only predefined commands allowed.`);
    }

    const school = db.get('SELECT id, name, code, status FROM schools WHERE id = ?', schoolId);
    if (!school) {
      throw new Error(`School ${schoolId} not found`);
    }

    const commandId = `CMD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const id = `cmd-rec-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString();

    db.run(
      `INSERT INTO remote_commands (id, command_id, school_id, command_type, payload_json, status, issued_by, expires_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      id, commandId, schoolId, commandType, JSON.stringify(payload), issuedBy, expiresAt
    );

    // Audit log
    logAudit({
      userId: issuedBy,
      action: 'ENQUEUE_REMOTE_COMMAND',
      targetType: 'SCHOOL',
      targetId: schoolId,
      details: { commandId, commandType, payload }
    });

    return {
      success: true,
      commandId,
      schoolId,
      commandType,
      expiresAt,
      status: 'PENDING'
    };
  }

  /**
   * Pull pending commands for a specific school (Called by School ERP Connector via API)
   */
  getPendingCommands(schoolId) {
    const commands = db.all(
      `SELECT id, command_id, command_type, payload_json, issued_at, expires_at
       FROM remote_commands
       WHERE school_id = ? AND status = 'PENDING' AND datetime(expires_at) > datetime('now')
       ORDER BY issued_at ASC`,
      schoolId
    );

    // Mark as DELIVERED
    if (commands.length > 0) {
      const ids = commands.map(c => `'${c.id}'`).join(',');
      db.exec(`UPDATE remote_commands SET status = 'DELIVERED' WHERE id IN (${ids})`);
    }

    return commands.map(c => ({
      id: c.id,
      commandId: c.command_id,
      commandType: c.command_type,
      payload: JSON.parse(c.payload_json || '{}'),
      issuedAt: c.issued_at,
      expiresAt: c.expires_at
    }));
  }

  /**
   * Acknowledge command execution results (Called by School ERP Connector via API)
   */
  acknowledgeCommand({ schoolId, commandId, executionStatus, resultLog = '' }) {
    const cmd = db.get(
      'SELECT id, command_id, school_id, command_type, payload_json, status FROM remote_commands WHERE command_id = ? AND school_id = ?',
      commandId, schoolId
    );

    if (!cmd) {
      throw new Error(`Command ${commandId} not found for school ${schoolId}`);
    }

    const finalStatus = executionStatus === 'SUCCESS' ? 'EXECUTED' : 'FAILED';
    const executedAt = new Date().toISOString();

    db.run(
      `UPDATE remote_commands 
       SET status = ?, executed_at = ?, result_log = ?
       WHERE id = ?`,
      finalStatus, executedAt, resultLog, cmd.id
    );

    const payload = JSON.parse(cmd.payload_json || '{}');

    // If execution succeeded, apply corresponding state changes to Central Platform
    if (finalStatus === 'EXECUTED') {
      if (cmd.command_type === 'SUSPEND_SERVICE') {
        db.run(
          `UPDATE schools 
           SET status = 'SUSPENDED', suspension_reason = ?, suspended_at = ?
           WHERE id = ?`,
          payload.reason || 'Service suspended by Central Administration',
          executedAt,
          schoolId
        );

        // Security event
        db.run(
          `INSERT INTO security_events (id, school_id, event_type, severity, user_identifier, description, source_erp, metadata_json)
           VALUES (?, ?, 'REMOTE_SERVICE_SUSPENSION', 'CRITICAL', 'Central Admin', ?, 'Central Command Engine', ?)`,
          `sec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          schoolId,
          `ERP service suspended remotely. Reason: ${payload.reason || 'Delinquent subscription'}`,
          JSON.stringify({ commandId, resultLog })
        );

        // System notification
        db.run(
          `INSERT INTO system_notifications (id, type, title, message, severity, school_id, action_url)
           VALUES (?, 'SERVICE_SUSPENDED', 'Remote Suspension Executed', ?, 'CRITICAL', ?, '/remote-controls')`,
          `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          `School ERP service for ${schoolId} successfully suspended. Access blocked, data preserved.`,
          schoolId
        );
      } else if (cmd.command_type === 'REACTIVATE_SERVICE') {
        db.run(
          `UPDATE schools 
           SET status = 'ACTIVE', suspension_reason = NULL, suspended_at = NULL, payment_status = 'PAID'
           WHERE id = ?`,
          schoolId
        );

        // Security event
        db.run(
          `INSERT INTO security_events (id, school_id, event_type, severity, user_identifier, description, source_erp, metadata_json)
           VALUES (?, ?, 'REMOTE_SERVICE_REACTIVATED', 'INFO', 'Central Admin', 'ERP service reactivated remotely. Normal access restored.', 'Central Command Engine', ?)`,
          `sec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          schoolId,
          JSON.stringify({ commandId, resultLog })
        );

        // System notification
        db.run(
          `INSERT INTO system_notifications (id, type, title, message, severity, school_id, action_url)
           VALUES (?, 'SERVICE_REACTIVATED', 'ERP Service Reactivated', ?, 'INFO', ?, '/schools')`,
          `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          `School ERP service for ${schoolId} successfully reactivated. Full access restored.`,
          schoolId
        );
      } else if (cmd.command_type === 'UPDATE_MODULES') {
        if (payload.enabled_modules) {
          db.run(
            'UPDATE schools SET active_modules_json = ? WHERE id = ?',
            JSON.stringify(payload.enabled_modules),
            schoolId
          );
        }
      } else if (cmd.command_type === 'EXTEND_SUBSCRIPTION') {
        if (payload.extend_days) {
          db.run(
            `UPDATE schools 
             SET subscription_end = datetime(subscription_end, ? || ' days')
             WHERE id = ?`,
            payload.extend_days.toString(),
            schoolId
          );
        }
      } else if (cmd.command_type === 'SET_GRACE_PERIOD') {
        if (payload.grace_period_days !== undefined) {
          db.run(
            'UPDATE schools SET grace_period_days = ? WHERE id = ?',
            parseInt(payload.grace_period_days, 10),
            schoolId
          );
        }
      }
    }

    db.savePermanentSnapshot();

    return {
      success: true,
      commandId,
      status: finalStatus,
      executedAt
    };
  }
}

module.exports = new CommandQueueService();
