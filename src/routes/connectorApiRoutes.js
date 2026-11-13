const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const { verifyHmacSignature } = require('../middleware/hmacAuth');
const commandQueueService = require('../services/commandQueueService');

// All connector endpoints require strict HMAC signature verification
router.use(verifyHmacSignature);

// GET /api/v1/connector/status - Check operational license & suspension status
router.get('/status', (req, res) => {
  try {
    const school = db.get(`
      SELECT 
        s.id, s.code, s.name, s.status, s.suspension_reason, s.suspended_at,
        s.active_modules_json, s.subscription_end, s.grace_period_days, s.payment_status
      FROM schools s
      WHERE s.id = ?
    `, req.school.id);

    const isServiceAllowed = school.status === 'ACTIVE' || school.status === 'TRIAL';

    res.json({
      success: true,
      data: {
        schoolId: school.id,
        code: school.code,
        name: school.name,
        operationalStatus: school.status,
        isServiceAllowed,
        suspensionReason: school.suspension_reason,
        suspendedAt: school.suspended_at,
        activeModules: JSON.parse(school.active_modules_json || '[]'),
        subscriptionEnd: school.subscription_end,
        gracePeriodDays: school.grace_period_days,
        paymentStatus: school.payment_status,
        serverTime: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/connector/heartbeat - Telemetry & vitality ping
router.post('/heartbeat', (req, res) => {
  try {
    const {
      cpu_usage_pct = 0,
      memory_usage_pct = 0,
      disk_usage_pct = 0,
      database_size_mb = 0,
      response_time_ms = 0,
      active_sessions = 0
    } = req.body;

    const id = `tel-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    db.run(`
      INSERT INTO erp_telemetry_history (
        id, school_id, cpu_usage_pct, memory_usage_pct, disk_usage_pct,
        database_size_mb, response_time_ms, active_sessions, ping_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
      id, req.school.id,
      parseFloat(cpu_usage_pct), parseFloat(memory_usage_pct), parseFloat(disk_usage_pct),
      parseFloat(database_size_mb), parseInt(response_time_ms, 10), parseInt(active_sessions, 10)
    );

    // Check if there are pending commands in queue
    const pendingCount = db.get(
      "SELECT COUNT(*) as cnt FROM remote_commands WHERE school_id = ? AND status = 'PENDING'",
      req.school.id
    );

    res.json({
      success: true,
      message: 'Heartbeat recorded successfully',
      hasPendingCommands: pendingCount ? pendingCount.cnt > 0 : false,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/connector/sync - Synchronize aggregated student, teacher, and activity stats
router.post('/sync', (req, res) => {
  try {
    const {
      idempotency_key,
      student_statistics = {},
      teacher_statistics = {},
      operational_statistics = {},
      security_events = []
    } = req.body;

    // Idempotency check: if key already exists, return previous success
    if (idempotency_key) {
      const existing = db.get('SELECT id, sync_timestamp FROM school_sync_metrics WHERE idempotency_key = ?', idempotency_key);
      if (existing) {
        return res.json({
          success: true,
          idempotent: true,
          message: 'Sync payload previously processed',
          syncId: existing.id,
          syncTimestamp: existing.sync_timestamp
        });
      }
    }

    const metricId = `met-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    db.transaction((tx) => {
      // 1. Insert metrics snapshot
      tx.run(`
        INSERT INTO school_sync_metrics (
          id, school_id, total_students, active_students, inactive_students,
          recent_admissions, departed_students, class_distribution_json,
          total_teachers, active_teachers, inactive_teachers,
          non_teaching_staff, recent_staff_hires, attendance_rate_pct,
          daily_active_logins, storage_used_mb, sync_source, idempotency_key
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, 'CONNECTOR_PUSH', ?
        )
      `,
        metricId,
        req.school.id,
        parseInt(student_statistics.total_students || 0, 10),
        parseInt(student_statistics.active_students || 0, 10),
        parseInt(student_statistics.inactive_students || 0, 10),
        parseInt(student_statistics.recent_admissions || 0, 10),
        parseInt(student_statistics.departed_students || 0, 10),
        JSON.stringify(student_statistics.class_distribution || {}),
        parseInt(teacher_statistics.total_teachers || 0, 10),
        parseInt(teacher_statistics.active_teachers || 0, 10),
        parseInt(teacher_statistics.inactive_teachers || 0, 10),
        parseInt(teacher_statistics.non_teaching_staff || 0, 10),
        parseInt(teacher_statistics.recent_staff_hires || 0, 10),
        parseFloat(operational_statistics.attendance_rate_pct || 0.0),
        parseInt(operational_statistics.daily_active_logins || 0, 10),
        parseFloat(operational_statistics.storage_used_mb || 0.0),
        idempotency_key || null
      );

      // 2. Update school's last_sync_at
      tx.run(
        "UPDATE schools SET last_sync_at = datetime('now'), health_status = 'HEALTHY' WHERE id = ?",
        req.school.id
      );

      // 3. Ingest local ERP security events if provided
      if (Array.isArray(security_events) && security_events.length > 0) {
        for (const evt of security_events) {
          const evtId = `sec-ingest-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          tx.run(`
            INSERT INTO security_events (
              id, school_id, event_type, severity, user_identifier, ip_address, description, source_erp, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            evtId,
            req.school.id,
            evt.event_type || 'GENERAL_ACTIVITY',
            evt.severity || 'INFO',
            evt.user_identifier || null,
            evt.ip_address || req.ip || null,
            evt.description || 'ERP operational event',
            req.school.name,
            JSON.stringify(evt.metadata || {})
          );
        }
      }
    });

    const pendingCount = db.get(
      "SELECT COUNT(*) as cnt FROM remote_commands WHERE school_id = ? AND status = 'PENDING'",
      req.school.id
    );

    db.savePermanentSnapshot();

    res.json({
      success: true,
      message: 'ERP statistics and telemetry successfully synchronized',
      syncId: metricId,
      hasPendingCommands: pendingCount ? pendingCount.cnt > 0 : false,
      syncTimestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/connector/commands/pending - Pull pending commands for this school
router.get('/commands/pending', (req, res) => {
  try {
    const commands = commandQueueService.getPendingCommands(req.school.id);
    res.json({
      success: true,
      count: commands.length,
      data: commands
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/connector/commands/:commandId/ack - Acknowledge command execution
router.post('/commands/:commandId/ack', (req, res) => {
  try {
    const { execution_status = 'SUCCESS', result_log = '' } = req.body;

    const result = commandQueueService.acknowledgeCommand({
      schoolId: req.school.id,
      commandId: req.params.commandId,
      executionStatus: execution_status,
      resultLog: result_log
    });

    res.json({
      success: true,
      message: 'Command execution acknowledged and recorded.',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
