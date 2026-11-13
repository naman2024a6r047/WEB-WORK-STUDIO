const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const commandQueueService = require('../services/commandQueueService');

/**
 * Dispatches a predefined remote command directly to the School ERP over HTTP.
 * Tries connector and central candidate endpoints.
 */
async function dispatchCommandToLiveErp({
  erpUrl,
  schoolId,
  commandId,
  commandType,
  payload = {},
  apiKey,
  hmacSecret,
  issuedBy = 'Central Admin',
  timeoutMs = 8000
}) {
  if (!erpUrl || !erpUrl.trim()) {
    return { success: false, deliveredLive: false, error: 'No erp_url configured for school' };
  }

  let cleanUrl = erpUrl.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }
  cleanUrl = cleanUrl.replace(/\/+$/, '');

  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch (e) {
    return { success: false, deliveredLive: false, error: `Invalid ERP URL: ${erpUrl}` };
  }

  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const baseWithoutApi = baseUrl;

  const commandEnvelope = {
    command_id: commandId,
    commandId,
    command_type: commandType,
    commandType,
    school_id: schoolId,
    schoolId,
    issued_by: issuedBy,
    payload,
    timestamp: Date.now()
  };

  const candidates = [];

  // Specialized direct endpoints for instant suspension / reactivation
  if (commandType === 'SUSPEND_SERVICE') {
    candidates.push({
      url: `${baseWithoutApi}/api/v1/connector/suspend`,
      method: 'POST',
      body: {
        command_id: commandId,
        command_type: commandType,
        school_id: schoolId,
        reason: payload.reason || 'Service suspended by Central Administration',
        payload,
        issued_by: issuedBy
      }
    });
    candidates.push({
      url: `${baseUrl}/api/v1/connector/suspend`,
      method: 'POST',
      body: {
        command_id: commandId,
        command_type: commandType,
        school_id: schoolId,
        reason: payload.reason || 'Service suspended by Central Administration',
        payload,
        issued_by: issuedBy
      }
    });
  } else if (commandType === 'REACTIVATE_SERVICE') {
    candidates.push({
      url: `${baseWithoutApi}/api/v1/connector/reactivate`,
      method: 'POST',
      body: {
        command_id: commandId,
        command_type: commandType,
        school_id: schoolId,
        payload,
        issued_by: issuedBy
      }
    });
    candidates.push({
      url: `${baseUrl}/api/v1/connector/reactivate`,
      method: 'POST',
      body: {
        command_id: commandId,
        command_type: commandType,
        school_id: schoolId,
        payload,
        issued_by: issuedBy
      }
    });
  }

  // Universal remote command endpoints
  candidates.push({
    url: `${baseWithoutApi}/api/v1/connector/command`,
    method: 'POST',
    body: commandEnvelope
  });
  candidates.push({
    url: `${baseUrl}/api/v1/connector/command`,
    method: 'POST',
    body: commandEnvelope
  });
  candidates.push({
    url: `${baseWithoutApi}/api/central/command`,
    method: 'POST',
    body: commandEnvelope
  });

  const errorsEncountered = [];

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const bodyStr = JSON.stringify(candidate.body || {});
      let signature = '';
      if (hmacSecret) {
        signature = crypto.createHmac('sha256', hmacSecret)
          .update(`${schoolId}:${timestamp}:${bodyStr}`)
          .digest('hex');
      }

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Central-ERP-Command/2.4.0',
        'X-Central-School-Id': schoolId || '',
        'x-school-id': schoolId || '',
        'X-Central-Url': 'https://wws.ktwr.in',
        'X-Timestamp': timestamp,
        'x-timestamp': timestamp
      };
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
        headers['x-api-key'] = apiKey;
        headers['X-Central-Command-Key'] = apiKey;
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (signature) {
        headers['X-Signature-256'] = signature;
        headers['x-signature'] = signature;
      }

      const res = await fetch(candidate.url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.status >= 200 && res.status < 300) {
        const data = await res.json().catch(() => ({}));
        if (data && data.success !== false) {
          return {
            success: true,
            deliveredLive: true,
            url: candidate.url,
            data,
            log: `Live dispatched to ${candidate.url}. ERP response: ${JSON.stringify(data).slice(0, 300)}`
          };
        }
      }

      let errSnippet = '';
      try {
        const text = await res.text();
        errSnippet = text.slice(0, 150).replace(/\s+/g, ' ');
      } catch {}
      errorsEncountered.push(`HTTP ${res.status} at ${candidate.url}${errSnippet ? ' -> ' + errSnippet : ''}`);
    } catch (fetchErr) {
      errorsEncountered.push(`${candidate.url} -> ${fetchErr.name === 'AbortError' ? 'Timeout' : fetchErr.message}`);
    }
  }

  return {
    success: false,
    deliveredLive: false,
    errors: errorsEncountered,
    log: `Offline / unreachable: ${errorsEncountered[0] || 'Connection error'}`
  };
}

// GET /api/v1/remote-control/commands - List command queue
router.get('/commands', authenticateToken, (req, res) => {
  try {
    const { school_id, status } = req.query;
    let sql = `
      SELECT 
        c.*,
        s.name as school_name,
        s.code as school_code,
        s.erp_url,
        s.status as school_status
      FROM remote_commands c
      JOIN schools s ON c.school_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (school_id) {
      sql += ' AND c.school_id = ?';
      params.push(school_id);
    }
    if (status) {
      sql += ' AND c.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY c.issued_at DESC LIMIT 50';

    const commands = db.all(sql, ...params);
    res.json({
      success: true,
      count: commands.length,
      data: commands.map(c => ({
        ...c,
        payload: JSON.parse(c.payload_json || '{}')
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/remote-control/issue - Issue predefined remote command
router.post('/issue', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), async (req, res) => {
  try {
    const { school_id, command_type, payload = {}, confirmation } = req.body;

    if (!school_id || !command_type) {
      return res.status(400).json({ success: false, error: 'school_id and command_type are required' });
    }

    // Require explicit confirmation for high-impact suspension command
    if (command_type === 'SUSPEND_SERVICE' && confirmation !== true) {
      return res.status(400).json({
        success: false,
        error: 'High-impact action: SUSPEND_SERVICE requires explicit confirmation: true'
      });
    }

    // Resolve school record
    const school = db.get('SELECT * FROM schools WHERE id = ? OR code = ?', school_id, school_id);
    if (!school) {
      return res.status(404).json({ success: false, error: `School ${school_id} not found` });
    }

    const result = commandQueueService.enqueueCommand({
      schoolId: school.id,
      commandType: command_type,
      payload,
      issuedBy: req.user.email
    });

    // Attempt live dispatch to the remote School ERP connector
    if (school.erp_url) {
      try {
        const liveDispatch = await dispatchCommandToLiveErp({
          erpUrl: school.erp_url,
          schoolId: school.code || school.id,
          commandId: result.commandId,
          commandType: command_type,
          payload,
          apiKey: school.api_key,
          hmacSecret: school.hmac_secret,
          issuedBy: req.user.email
        });

        if (liveDispatch.success) {
          // Acknowledge execution immediately and synchronize school state
          const ack = commandQueueService.acknowledgeCommand({
            schoolId: school.id,
            commandId: result.commandId,
            executionStatus: 'SUCCESS',
            resultLog: liveDispatch.log
          });

          return res.status(200).json({
            success: true,
            deliveredLive: true,
            executionStatus: 'EXECUTED',
            message: `Predefined command ${command_type} dispatched and executed live on School ERP (${school.erp_url}). State synchronized.`,
            data: {
              ...result,
              status: 'EXECUTED',
              erpResponse: liveDispatch.data,
              ack
            }
          });
        }
      } catch (dispErr) {
        console.warn(`[RemoteControl /issue] Live dispatch error to ${school.erp_url}:`, dispErr.message);
      }
    }

    // Fallback: Queued as PENDING for school ERP connector heartbeat polling
    res.status(201).json({
      success: true,
      deliveredLive: false,
      executionStatus: 'PENDING',
      message: `Predefined remote command ${command_type} enqueued successfully. Pending delivery to school ERP connector.`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/remote-control/simulate-execution - Instantly simulate connector polling & execution
// (Useful for interactive dashboard demo and verification)
router.post('/simulate-execution', authenticateToken, requireRole(['SUPER_ADMIN']), (req, res) => {
  try {
    const { command_id } = req.body;
    if (!command_id) {
      return res.status(400).json({ success: false, error: 'command_id is required' });
    }

    const cmd = db.get('SELECT * FROM remote_commands WHERE command_id = ?', command_id);
    if (!cmd) {
      return res.status(404).json({ success: false, error: 'Command not found' });
    }

    const payload = JSON.parse(cmd.payload_json || '{}');
    let executionLog = `Simulated execution by ${req.user.email}. Predefined command ${cmd.command_type} verified and applied locally.`;

    if (cmd.command_type === 'SUSPEND_SERVICE') {
      executionLog += ` School ERP user routing locked. Redirection to /service-suspended active. Reason: ${payload.reason || 'Overdue subscription'}. School database remains 100% intact.`;
    } else if (cmd.command_type === 'REACTIVATE_SERVICE') {
      executionLog += ' School ERP resumed. Normal login access restored for all students, teachers, and admins.';
    }

    const ack = commandQueueService.acknowledgeCommand({
      schoolId: cmd.school_id,
      commandId: cmd.command_id,
      executionStatus: 'SUCCESS',
      resultLog: executionLog
    });

    res.json({
      success: true,
      message: 'Command executed and state synchronized successfully.',
      data: ack
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
