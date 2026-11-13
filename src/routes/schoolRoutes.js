const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/auditLogger');
const automationEngine = require('../services/automationEngine');

// GET /api/v1/schools - List schools with filters, search, pagination
router.get('/', authenticateToken, (req, res) => {
  try {
    const { status, plan, payment_status, health, search, sort_by = 'name', order = 'ASC' } = req.query;

    let sql = `
      SELECT 
        s.*,
        p.name as plan_name,
        p.code as plan_code,
        p.monthly_price as plan_monthly_price,
        p.annual_price as plan_annual_price,
        COALESCE(m.total_students, 0) as total_students,
        COALESCE(m.active_students, 0) as active_students,
        COALESCE(m.total_teachers, 0) as total_teachers,
        COALESCE(m.attendance_rate_pct, 0) as attendance_rate,
        COALESCE(m.daily_active_logins, 0) as daily_logins,
        COALESCE(m.storage_used_mb, 0) as storage_used_mb,
        COALESCE(inv_stats.unpaid_balance, 0) as outstanding_balance
      FROM schools s
      LEFT JOIN subscription_plans p ON s.plan_id = p.id
      LEFT JOIN (
        SELECT m1.* FROM school_sync_metrics m1
        INNER JOIN (
          SELECT school_id, MAX(sync_timestamp) as max_sync 
          FROM school_sync_metrics GROUP BY school_id
        ) m2 ON m1.school_id = m2.school_id AND m1.sync_timestamp = m2.max_sync
      ) m ON s.id = m.school_id
      LEFT JOIN (
        SELECT school_id, SUM(balance_due) as unpaid_balance 
        FROM invoices 
        WHERE status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
        GROUP BY school_id
      ) inv_stats ON s.id = inv_stats.school_id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      sql += ' AND s.status = ?';
      params.push(status);
    }
    if (plan) {
      sql += ' AND s.plan_id = ?';
      params.push(plan);
    }
    if (payment_status) {
      sql += ' AND s.payment_status = ?';
      params.push(payment_status);
    }
    if (health) {
      sql += ' AND s.health_status = ?';
      params.push(health);
    }
    if (search) {
      sql += ' AND (s.name LIKE ? OR s.code LIKE ? OR s.city LIKE ? OR s.owner_name LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    // Safe sorting fields
    const validSorts = ['name', 'created_at', 'total_students', 'total_teachers', 'status', 'subscription_end'];
    const sortCol = validSorts.includes(sort_by) ? sort_by : 'name';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    const schools = db.all(sql, ...params);

    // Redact raw hmac_secret in list view for security
    const safeSchools = schools.map(s => {
      const { hmac_secret, ...rest } = s;
      const cycleMultiplier = s.billing_cycle === 'YEARLY' ? 12 : s.billing_cycle === 'HALF_YEARLY' ? 6 : s.billing_cycle === 'QUARTERLY' ? 3 : 1;
      const dynamicAmount = s.pricing_model === 'PER_STUDENT'
        ? Math.round((s.total_students || 0) * (s.price_per_student || 25.0) * cycleMultiplier)
        : (s.custom_price || (s.billing_cycle === 'YEARLY' ? s.plan_annual_price : s.plan_monthly_price) || 0);

      return {
        ...rest,
        pricing_model: s.pricing_model || 'PER_STUDENT',
        price_per_student: s.price_per_student !== undefined && s.price_per_student !== null ? s.price_per_student : 25.0,
        calculated_subscription_amount: s.calculated_subscription_amount > 0 ? s.calculated_subscription_amount : dynamicAmount,
        last_student_check_at: s.last_student_check_at || s.last_sync_at,
        has_hmac_secret: Boolean(hmac_secret)
      };
    });

    res.json({
      success: true,
      count: safeSchools.length,
      data: safeSchools
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/schools/:id - Detailed individual school profile
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const school = db.get(`
      SELECT 
        s.*,
        p.name as plan_name,
        p.code as plan_code,
        p.monthly_price as plan_monthly_price,
        p.annual_price as plan_annual_price,
        p.features_json as plan_features,
        p.modules_json as plan_allowed_modules
      FROM schools s
      LEFT JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.id = ?
    `, req.params.id);

    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    // 1. Latest Synchronized Student & Teacher Metrics
    const latestMetrics = db.get(`
      SELECT * FROM school_sync_metrics 
      WHERE school_id = ? 
      ORDER BY sync_timestamp DESC, rowid DESC 
      LIMIT 1
    `, req.params.id);

    // 2. Billing & Invoices
    const invoices = db.all(`
      SELECT * FROM invoices 
      WHERE school_id = ? 
      ORDER BY issue_date DESC
    `, req.params.id);

    // 3. Payments History
    const payments = db.all(`
      SELECT p.*, i.invoice_number 
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      WHERE p.school_id = ?
      ORDER BY p.payment_date DESC
    `, req.params.id);

    // 4. Remote Command History
    const commands = db.all(`
      SELECT * FROM remote_commands 
      WHERE school_id = ? 
      ORDER BY issued_at DESC 
      LIMIT 10
    `, req.params.id);

    // 5. Recent Security Events
    const securityEvents = db.all(`
      SELECT * FROM security_events 
      WHERE school_id = ? 
      ORDER BY created_at DESC 
      LIMIT 15
    `, req.params.id);

    // 6. Telemetry History (Last 10 pings)
    const telemetry = db.all(`
      SELECT * FROM erp_telemetry_history 
      WHERE school_id = ? 
      ORDER BY ping_timestamp DESC 
      LIMIT 12
    `, req.params.id);

    // Redact full hmac_secret preview
    const maskedSecret = school.hmac_secret 
      ? `${school.hmac_secret.slice(0, 8)}...${school.hmac_secret.slice(-6)}`
      : 'Not Generated';

    res.json({
      success: true,
      data: {
        school: {
          ...school,
          hmac_secret_preview: maskedSecret,
          active_modules: JSON.parse(school.active_modules_json || '[]')
        },
        metrics: latestMetrics ? {
          ...latestMetrics,
          class_distribution: JSON.parse(latestMetrics.class_distribution_json || '{}')
        } : null,
        invoices,
        payments,
        commands,
        securityEvents,
        telemetry
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/schools/generate-credentials - Generate unique School ID and cryptographic keys
router.get('/generate-credentials', authenticateToken, (req, res) => {
  try {
    let schoolId;
    let code;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 20) {
      attempts++;
      const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
      schoolId = `SCH-${randomSuffix}`;
      code = schoolId;
      const existing = db.get('SELECT id FROM schools WHERE id = ? OR code = ? OR remote_school_id = ?', schoolId, code, schoolId);
      if (!existing) {
        isUnique = true;
      }
    }

    const apiKey = `cc_live_pk_${crypto.randomBytes(12).toString('hex')}`;
    const hmacSecret = `cc_sec_live_${crypto.randomBytes(24).toString('hex')}`;
    const approvalToken = `appr_req_${crypto.randomBytes(16).toString('hex')}`;

    res.json({
      success: true,
      data: {
        schoolId,
        code,
        apiKey,
        hmacSecret,
        approvalToken,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// School ERP Live Probe & Census Normalization Helpers
// ============================================================================

/**
 * Normalizes census data from disparate school ERP payloads
 */
function extractCensusFromPayload(data) {
  if (!data || typeof data !== 'object') return null;

  // 1. Nested connector SDK format (student_statistics / teacher_statistics)
  if (data.student_statistics) {
    const s = data.student_statistics;
    const t = data.teacher_statistics || {};
    const o = data.operational_statistics || {};
    const total = parseInt(s.total_students ?? s.totalStudents ?? 0, 10);
    return {
      totalStudents: total,
      activeStudents: parseInt(s.active_students ?? s.activeStudents ?? total, 10),
      teachers: parseInt(t.total_teachers ?? t.teachers ?? 0, 10),
      staff: parseInt(t.non_teaching_staff ?? t.staff ?? 0, 10),
      attendanceRate: parseFloat(o.attendance_rate_pct ?? o.attendanceRate ?? 95.0),
      classDistribution: s.class_distribution || s.classDistribution || {
        "Grades 1-5": Math.round(total * 0.4),
        "Grades 6-8": Math.round(total * 0.3),
        "Grades 9-12": Math.round(total * 0.3)
      }
    };
  }

  // 2. Flat format or simple JSON object
  const total = data.totalStudents ?? data.total_students ?? data.student_count ?? data.students;
  if (total !== undefined && total !== null && !isNaN(parseInt(total, 10))) {
    const totalStudents = parseInt(total, 10);
    const activeStudents = parseInt(data.activeStudents ?? data.active_students ?? totalStudents, 10);
    const teachers = parseInt(data.teachers ?? data.total_teachers ?? data.faculty ?? Math.max(12, Math.round(totalStudents / 22)), 10);
    const staff = parseInt(data.staff ?? data.non_teaching_staff ?? Math.max(4, Math.round(teachers / 3)), 10);
    const attendanceRate = parseFloat(data.attendanceRate ?? data.attendance_rate_pct ?? data.attendance ?? 95.0);
    const classDistribution = data.classDistribution || data.class_distribution || {
      "Primary Wing (1-5)": Math.round(totalStudents * 0.4),
      "Middle Wing (6-8)": Math.round(totalStudents * 0.3),
      "Secondary Wing (9-12)": Math.round(totalStudents * 0.3)
    };
    return {
      totalStudents,
      activeStudents,
      teachers,
      staff,
      attendanceRate,
      classDistribution
    };
  }

  return null;
}

/**
 * Diagnostic HTTP probe to query real live data from a School ERP.
 * Tries multiple common candidate endpoints and returns structured diagnostics on failure.
 */
async function probeLiveSchoolErp({ erpUrl, schoolId, apiKey, hmacSecret, schoolName, timeoutMs = 7000 }) {
  if (!erpUrl || !erpUrl.trim()) {
    return {
      success: false,
      error: 'School ERP Base URL is empty.',
      diagnostic: { problem: 'Missing ERP URL', suggestion: 'Please enter the URL of the school ERP.' }
    };
  }

  let cleanUrl = erpUrl.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }
  cleanUrl = cleanUrl.replace(/\/+$/, '');

  let parsedUrl;
  try {
    parsedUrl = new URL(cleanUrl);
  } catch (err) {
    return {
      success: false,
      error: `Invalid URL format "${erpUrl}": ${err.message}`,
      diagnostic: {
        attemptedUrl: cleanUrl,
        problem: 'URL syntax error',
        suggestion: 'Ensure the URL starts with https:// or http:// and has a valid hostname (e.g. https://myschool.com).'
      }
    };
  }

  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const baseWithoutApi = cleanUrl.replace(/\/api(\/v1)?(\/connector)?\/?$/i, '');

  const hasSpecificPath = parsedUrl.pathname && parsedUrl.pathname !== '/' && (
    parsedUrl.pathname.includes('/census') ||
    parsedUrl.pathname.includes('/metrics') ||
    parsedUrl.pathname.includes('/approval') ||
    parsedUrl.pathname.includes('/students')
  );

  const approvalPayload = {
    school_id: schoolId,
    api_key: apiKey,
    hmac_secret: hmacSecret,
    action: 'REQUEST_DATA_ACCESS_APPROVAL',
    requested_scopes: ['census', 'faculty', 'attendance', 'finance', 'telemetry'],
    central_url: 'https://wws.ktwr.in',
    requester: 'Central ERP Command (https://wws.ktwr.in)',
    timestamp: new Date().toISOString()
  };

  const candidates = [];
  if (hasSpecificPath) {
    candidates.push({ url: cleanUrl, method: 'POST', body: approvalPayload });
    candidates.push({ url: cleanUrl, method: 'GET' });
  } else {
    // 1. Standard Central Connector approval request endpoint
    candidates.push({
      url: `${baseWithoutApi}/api/v1/connector/approval-request`,
      method: 'POST',
      body: approvalPayload
    });
    // 2. Direct base approval request
    candidates.push({
      url: `${baseUrl}/api/v1/connector/approval-request`,
      method: 'POST',
      body: approvalPayload
    });
    // 3. Central Webhook / approve endpoint
    candidates.push({
      url: `${baseWithoutApi}/api/central/approve`,
      method: 'POST',
      body: approvalPayload
    });
    // 4. Live Census GET endpoints
    candidates.push({
      url: `${baseWithoutApi}/api/v1/connector/census?schoolId=${encodeURIComponent(schoolId || '')}`,
      method: 'GET'
    });
    candidates.push({
      url: `${baseUrl}/api/v1/connector/census?schoolId=${encodeURIComponent(schoolId || '')}`,
      method: 'GET'
    });
    candidates.push({
      url: `${baseWithoutApi}/api/connector/census?schoolId=${encodeURIComponent(schoolId || '')}`,
      method: 'GET'
    });
  }

  const errorsEncountered = [];

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Central-ERP-Command/2.4.0',
        'X-Central-School-Id': schoolId || '',
        'X-Central-Url': 'https://wws.ktwr.in'
      };
      if (apiKey) {
        headers['X-Central-Command-Key'] = apiKey;
        headers['X-Api-Key'] = apiKey;
      }

      const fetchOptions = {
        method: candidate.method,
        headers,
        redirect: 'follow',
        signal: controller.signal
      };

      if (candidate.method === 'POST' && candidate.body) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(candidate.body);
      }

      const res = await fetch(candidate.url, fetchOptions);
      clearTimeout(timeoutId);

      const status = res.status;
      const contentType = res.headers.get('content-type') || '';

      if (!res.ok) {
        let errSnippet = '';
        try {
          const text = await res.text();
          errSnippet = text.slice(0, 200).replace(/\s+/g, ' ');
        } catch {}
        errorsEncountered.push(`HTTP ${status} (${res.statusText}) at ${candidate.url}${errSnippet ? ' -> ' + errSnippet : ''}`);
        continue;
      }

      if (!contentType.includes('application/json')) {
        let textSnippet = '';
        try {
          const text = await res.text();
          textSnippet = text.slice(0, 150).replace(/\s+/g, ' ');
        } catch {}
        errorsEncountered.push(`Non-JSON response (received ${contentType || 'HTML/Text'}) at ${candidate.url}. Preview: "${textSnippet}"`);
        continue;
      }

      const json = await res.json();
      const payload = json.data || json;

      const normalized = extractCensusFromPayload(payload);
      if (normalized) {
        return {
          success: true,
          endpointUsed: candidate.url,
          data: {
            ...normalized,
            schoolId: schoolId,
            erpUrl: cleanUrl,
            source: 'LIVE_REMOTE_ERP',
            verified: true,
            fetchedAt: new Date().toISOString()
          }
        };
      } else {
        errorsEncountered.push(`JSON response received at ${candidate.url}, but no student census fields found. Received keys: [${Object.keys(payload || {}).join(', ')}]`);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        errorsEncountered.push(`Connection timed out (${Math.round(timeoutMs / 1000)}s) at ${candidate.url}. Remote server did not respond.`);
      } else if (err.code === 'ENOTFOUND') {
        errorsEncountered.push(`DNS lookup failed for "${parsedUrl.hostname}". Domain or host does not exist.`);
      } else if (err.code === 'ECONNREFUSED') {
        errorsEncountered.push(`Connection refused at ${candidate.url}. Remote server is offline or port blocked.`);
      } else if (err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || (err.message && err.message.includes('certificate'))) {
        errorsEncountered.push(`SSL certificate error at ${candidate.url}: ${err.message}`);
      } else {
        errorsEncountered.push(`Network error at ${candidate.url}: ${err.message}`);
      }
    }
  }

  const primaryError = errorsEncountered[0] || 'Unknown connection error';
  return {
    success: false,
    error: primaryError,
    diagnostic: {
      attemptedUrl: cleanUrl,
      host: parsedUrl.hostname,
      endpointsTested: candidates.map(c => `${c.method} ${c.url}`),
      errors: errorsEncountered,
      suggestions: [
        `Verify that the School ERP website at "${cleanUrl}" is running and publicly reachable.`,
        `Ensure the School ERP exposes a Central Command connector endpoint (/api/v1/connector/approval-request or /api/v1/connector/census).`,
        `Check if firewall, Cloudflare, or hosting rules on "${parsedUrl.hostname}" are blocking incoming requests.`,
        `If your ERP is still in staging/development, you can use "Continue with Demo / Simulated Census for Testing".`
      ]
    }
  };
}

/**
 * Deterministic simulation generator for offline/demo/testing mode
 */
function generateSimulatedCensus(schoolId, erpUrl) {
  let hash = 0;
  for (let i = 0; i < schoolId.length; i++) {
    hash = (hash << 5) - hash + schoolId.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);
  const studentCount = 420 + (positiveHash % 880);
  const activeCount = Math.round(studentCount * 0.98);
  const teacherCount = Math.max(16, Math.round(studentCount / 20));
  const staffCount = Math.max(6, Math.round(teacherCount / 3));
  const attendance = (93 + (positiveHash % 50) / 10).toFixed(1);

  return {
    schoolId,
    erpUrl,
    approvalStatus: 'APPROVED',
    approvalToken: `appr_ack_${crypto.randomBytes(12).toString('hex')}`,
    approvedAt: new Date().toISOString(),
    verified: false,
    source: 'OFFLINE_DEMO_SIMULATION',
    isSimulated: true,
    totalStudents: studentCount,
    activeStudents: activeCount,
    teachers: teacherCount,
    staff: staffCount,
    attendanceRate: parseFloat(attendance),
    classDistribution: {
      "Primary Wing (Grades 1-5)": Math.round(studentCount * 0.38),
      "Middle Wing (Grades 6-8)": Math.round(studentCount * 0.28),
      "Secondary Wing (Grades 9-10)": Math.round(studentCount * 0.20),
      "Senior Secondary (Grades 11-12)": Math.round(studentCount * 0.14)
    }
  };
}

// POST /api/v1/schools/send-approval-request - Dispatch approval request to school ERP and fetch real data
router.post('/send-approval-request', authenticateToken, async (req, res) => {
  try {
    const { school_id, erp_url, api_key, hmac_secret, school_name, allow_offline_demo } = req.body;

    if (!school_id || !school_id.trim()) {
      return res.status(400).json({ success: false, error: 'School ID is required to send approval request.' });
    }
    if (!erp_url || !erp_url.trim()) {
      return res.status(400).json({ success: false, error: 'School ERP Base URL is required to dispatch approval request.' });
    }

    const cleanSchoolId = school_id.trim().toUpperCase();
    const cleanApiKey = api_key ? api_key.trim() : `cc_live_pk_${crypto.randomBytes(12).toString('hex')}`;
    const cleanHmacSecret = hmac_secret ? hmac_secret.trim() : `cc_sec_live_${crypto.randomBytes(24).toString('hex')}`;

    // 1. Attempt live HTTP dispatch to remote school ERP connector
    const probeResult = await probeLiveSchoolErp({
      erpUrl: erp_url,
      schoolId: cleanSchoolId,
      apiKey: cleanApiKey,
      hmacSecret: cleanHmacSecret,
      schoolName
    });

    if (probeResult.success) {
      const data = probeResult.data;
      const approvalToken = `appr_ack_${crypto.randomBytes(12).toString('hex')}`;
      return res.json({
        success: true,
        approvalStatus: 'APPROVED',
        message: `Approval request dispatched and successfully received by School ERP at ${data.erpUrl}! Verified live census: ${data.totalStudents.toLocaleString()} students, ${data.teachers} teachers.`,
        receivedByErp: true,
        data: {
          ...data,
          receivedByErp: true,
          approvalToken,
          approvalStatus: data.approvalStatus || 'APPROVED',
          approvedAt: new Date().toISOString()
        }
      });
    }

    // 2. If live fetch failed, check if user requested offline demo simulation
    if (allow_offline_demo) {
      const demoData = generateSimulatedCensus(cleanSchoolId, erp_url);
      return res.json({
        success: true,
        approvalStatus: 'APPROVED',
        isSimulated: true,
        warning: `Could not connect to live School ERP (${probeResult.error}). Loaded simulated test census (${demoData.totalStudents} students).`,
        message: `Loaded offline simulated census for testing (${demoData.totalStudents} students). Note: Real ERP connection failed: ${probeResult.error}`,
        data: demoData,
        diagnostic: probeResult.diagnostic
      });
    }

    // Return detailed, transparent error diagnostic
    return res.status(502).json({
      success: false,
      error: `Could not fetch real data from School ERP: ${probeResult.error}`,
      diagnostic: probeResult.diagnostic
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/schools/probe-remote-erp - Probe school ERP with School ID and handshake (alias for backward compatibility)
router.post('/probe-remote-erp', authenticateToken, async (req, res) => {
  try {
    const { remote_school_id, school_id, erp_url, api_key, hmac_secret, allow_offline_demo } = req.body;
    const targetId = remote_school_id || school_id;

    if (!targetId || !targetId.trim()) {
      return res.status(400).json({ success: false, error: 'Please enter the Remote School ID from that school ERP.' });
    }
    if (!erp_url || !erp_url.trim()) {
      return res.status(400).json({ success: false, error: 'Please enter the School ERP Base URL.' });
    }

    const cleanSchoolId = targetId.trim().toUpperCase();
    const probeResult = await probeLiveSchoolErp({
      erpUrl: erp_url,
      schoolId: cleanSchoolId,
      apiKey,
      hmacSecret
    });

    if (probeResult.success) {
      const data = probeResult.data;
      const approvalToken = `appr_ack_${crypto.randomBytes(12).toString('hex')}`;
      return res.json({
        success: true,
        approvalStatus: 'APPROVED',
        message: `Connected to School ERP at ${data.erpUrl}. Verified live census: ${data.totalStudents.toLocaleString()} students.`,
        data: {
          ...data,
          remoteSchoolId: cleanSchoolId,
          approvalToken,
          approvalStatus: 'APPROVED',
          approvedAt: new Date().toISOString()
        }
      });
    }

    if (allow_offline_demo) {
      const demoData = generateSimulatedCensus(cleanSchoolId, erp_url);
      return res.json({
        success: true,
        approvalStatus: 'APPROVED',
        isSimulated: true,
        warning: `Could not connect to live School ERP (${probeResult.error}). Loaded simulated test census.`,
        message: `Loaded offline simulated census for testing (${demoData.totalStudents} students).`,
        data: {
          ...demoData,
          remoteSchoolId: cleanSchoolId
        },
        diagnostic: probeResult.diagnostic
      });
    }

    return res.status(502).json({
      success: false,
      error: `Could not fetch real data from School ERP: ${probeResult.error}`,
      diagnostic: probeResult.diagnostic
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/schools - Register a new school centrally
router.post('/', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), (req, res) => {
  try {
    const {
      school_id, name, code, remote_school_id, api_key, hmac_secret,
      data_access_approved, approval_status = 'APPROVED', approval_token,
      logo_url, erp_url, address, city, state, country = 'India',
      owner_name, owner_email, owner_phone, tech_contact_name, tech_contact_email, tech_contact_phone,
      plan_id = 'plan-growth', billing_cycle = 'MONTHLY', custom_price,
      pricing_model = 'PER_STUDENT', price_per_student = 25.0, initial_students = 0,
      subscription_start = new Date().toISOString().slice(0, 10),
      subscription_end,
      grace_period_days = 7, auto_suspend_enabled = 0
    } = req.body;

    if (!name || !erp_url || !owner_name || !owner_email || !owner_phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required school registration fields (name, erp_url, owner_name, owner_email, owner_phone)'
      });
    }

    // Determine final IDs and codes
    const finalSchoolId = (school_id && school_id.trim()) 
      ? school_id.trim().toUpperCase() 
      : `SCH-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
    
    const finalCode = (code && code.trim()) ? code.trim().toUpperCase() : finalSchoolId;
    const finalRemoteSchoolId = (remote_school_id && remote_school_id.trim()) 
      ? remote_school_id.trim().toUpperCase() 
      : finalSchoolId;

    const isApproved = Boolean(
      data_access_approved === true || data_access_approved === 1 || data_access_approved === '1' || data_access_approved === 'true' ||
      approval_status === 'APPROVED'
    );
    if (!isApproved) {
      return res.status(400).json({
        success: false,
        error: 'Data access approval is required from the school ERP administrator to ingest student and financial records.'
      });
    }

    // Check unique code or ID
    const existing = db.get('SELECT id FROM schools WHERE code = ? OR id = ?', finalCode, finalSchoolId);
    if (existing) {
      return res.status(400).json({ success: false, error: `School identifier "${finalCode}" is already in use. Please generate a new School ID.` });
    }

    // Provision or use generated integration credentials
    const finalApiKey = (api_key && api_key.trim()) ? api_key.trim() : `cc_live_pk_${crypto.randomBytes(12).toString('hex')}`;
    const finalHmacSecret = (hmac_secret && hmac_secret.trim()) ? hmac_secret.trim() : `cc_sec_live_${crypto.randomBytes(24).toString('hex')}`;
    const finalApprovalToken = approval_token || `appr_ack_${crypto.randomBytes(12).toString('hex')}`;

    // Default expiry 1 year or 1 month ahead if not specified
    const calculatedEnd = subscription_end || (
      billing_cycle === 'YEARLY' 
        ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
        : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    );

    const cycleMultiplier = billing_cycle === 'YEARLY' ? 12 : billing_cycle === 'HALF_YEARLY' ? 6 : billing_cycle === 'QUARTERLY' ? 3 : 1;
    const numStudents = parseInt(initial_students, 10) || 0;
    const numPricePerStudent = parseFloat(price_per_student) || 25.0;
    const calculatedAmount = pricing_model === 'PER_STUDENT'
      ? Math.round(numStudents * numPricePerStudent * cycleMultiplier)
      : (parseFloat(custom_price) || 0);

    db.run(`
      INSERT INTO schools (
        id, code, remote_school_id, data_access_approved, approval_status, approval_token, approved_at,
        name, logo_url, erp_url, address, city, state, country,
        owner_name, owner_email, owner_phone, tech_contact_name, tech_contact_email, tech_contact_phone,
        plan_id, billing_cycle, custom_price, pricing_model, price_per_student, calculated_subscription_amount, last_student_check_at,
        subscription_start, subscription_end, grace_period_days, auto_suspend_enabled,
        payment_status, status, active_modules_json, api_key, hmac_secret, health_status
      ) VALUES (
        ?, ?, ?, 1, 'APPROVED', ?, datetime('now'),
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, datetime('now'),
        ?, ?, ?, ?,
        'PENDING', 'ACTIVE', '["admissions","attendance","fees","academics","reports"]', ?, ?, 'HEALTHY'
      )
    `,
      finalSchoolId, finalCode, finalRemoteSchoolId, finalApprovalToken,
      name.trim(), logo_url || null, erp_url.trim(), address || '', city || '', state || '', country,
      owner_name, owner_email, owner_phone, tech_contact_name || '', tech_contact_email || '', tech_contact_phone || '',
      plan_id, billing_cycle, custom_price || null, pricing_model, numPricePerStudent, calculatedAmount,
      subscription_start, calculatedEnd, grace_period_days, auto_suspend_enabled ? 1 : 0,
      finalApiKey, finalHmacSecret
    );

    // Initial student census record if students provided
    if (numStudents > 0) {
      const metricId = `met-init-${Date.now()}`;
      db.run(`
        INSERT INTO school_sync_metrics (
          id, school_id, total_students, active_students, inactive_students,
          recent_admissions, departed_students, class_distribution_json,
          total_teachers, active_teachers, inactive_teachers,
          non_teaching_staff, recent_staff_hires, attendance_rate_pct,
          daily_active_logins, storage_used_mb, sync_source
        ) VALUES (
          ?, ?, ?, ?, 0,
          ?, 0, '{}',
          ?, ?, 0,
          ?, 0, 95.0,
          ?, ?, 'INITIAL_ONBOARDING'
        )
      `,
        metricId, finalSchoolId, numStudents, numStudents,
        numStudents,
        Math.max(1, Math.round(numStudents / 20)), Math.max(1, Math.round(numStudents / 20)),
        Math.max(1, Math.round(numStudents / 40)),
        Math.round(numStudents * 0.7), Math.round(numStudents * 15.0)
      );
    }

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'REGISTER_SCHOOL',
      targetType: 'SCHOOL',
      targetId: finalSchoolId,
      details: { name, schoolId: finalSchoolId, code: finalCode, plan_id, billing_cycle, pricing_model, numPricePerStudent, calculatedAmount },
      ip: req.ip
    });

    db.savePermanentSnapshot();

    res.status(201).json({
      success: true,
      message: 'School registered successfully with generated keys, School ID, and authorized live data access.',
      data: {
        schoolId: finalSchoolId,
        code: finalCode,
        remoteSchoolId: finalRemoteSchoolId,
        name: name.trim(),
        apiKey: finalApiKey,
        hmacSecret: finalHmacSecret, // Shown once during registration
        approvalStatus: 'APPROVED',
        erpUrl: erp_url.trim(),
        pricingModel: pricing_model,
        pricePerStudent: numPricePerStudent,
        initialStudents: numStudents,
        calculatedAmount,
        billingCycle: billing_cycle
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/schools/:id/rotate-credentials - Rotate API Key & HMAC Secret
router.post('/:id/rotate-credentials', authenticateToken, requireRole(['SUPER_ADMIN']), (req, res) => {
  try {
    const school = db.get('SELECT id, name FROM schools WHERE id = ?', req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    const newApiKey = `key_live_${crypto.randomBytes(12).toString('hex')}`;
    const newHmacSecret = `sec_live_hmac_${crypto.randomBytes(24).toString('hex')}`;

    db.run(
      'UPDATE schools SET api_key = ?, hmac_secret = ?, updated_at = datetime("now") WHERE id = ?',
      newApiKey, newHmacSecret, school.id
    );

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'ROTATE_CREDENTIALS',
      targetType: 'SCHOOL',
      targetId: school.id,
      details: { schoolName: school.name },
      ip: req.ip
    });

    db.savePermanentSnapshot();

    res.json({
      success: true,
      message: 'Credentials rotated successfully. Update your school ERP connector configuration immediately.',
      data: {
        schoolId: school.id,
        newApiKey,
        newHmacSecret
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/v1/schools/:id - Update school details
router.put('/:id', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), (req, res) => {
  try {
    const school = db.get('SELECT * FROM schools WHERE id = ?', req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    const {
      name, erp_url, logo_url, address, city, state, country,
      owner_name, owner_email, owner_phone,
      tech_contact_name, tech_contact_email, tech_contact_phone,
      plan_id, billing_cycle, pricing_model, price_per_student, custom_price,
      calculated_subscription_amount, grace_period_days, auto_suspend_enabled,
      subscription_start, subscription_end,
      status, payment_status, active_modules
    } = req.body;

    let activeModulesJson = null;
    if (active_modules !== undefined) {
      activeModulesJson = Array.isArray(active_modules) ? JSON.stringify(active_modules) : active_modules;
    }

    // Auto-calculate subscription amount if pricing parameters changed
    let newCalculatedAmount = calculated_subscription_amount;
    const finalPricingModel = pricing_model !== undefined ? pricing_model : school.pricing_model;
    const finalCycle = billing_cycle !== undefined ? billing_cycle : school.billing_cycle;
    const finalPricePerStudent = price_per_student !== undefined ? parseFloat(price_per_student) : school.price_per_student;

    if (newCalculatedAmount === undefined) {
      if (finalPricingModel === 'PER_STUDENT') {
        const latestMetric = db.get('SELECT total_students FROM school_sync_metrics WHERE school_id = ? ORDER BY sync_timestamp DESC LIMIT 1', school.id);
        const studentCount = latestMetric ? latestMetric.total_students : 0;
        const cycleMultiplier = finalCycle === 'YEARLY' ? 12 : finalCycle === 'HALF_YEARLY' ? 6 : finalCycle === 'QUARTERLY' ? 3 : 1;
        newCalculatedAmount = Math.round(studentCount * finalPricePerStudent * cycleMultiplier);
      } else if (custom_price !== undefined && custom_price !== null) {
        newCalculatedAmount = parseFloat(custom_price);
      }
    }

    db.run(`
      UPDATE schools SET
        name = COALESCE(?, name),
        erp_url = COALESCE(?, erp_url),
        logo_url = COALESCE(?, logo_url),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        country = COALESCE(?, country),
        owner_name = COALESCE(?, owner_name),
        owner_email = COALESCE(?, owner_email),
        owner_phone = COALESCE(?, owner_phone),
        tech_contact_name = COALESCE(?, tech_contact_name),
        tech_contact_email = COALESCE(?, tech_contact_email),
        tech_contact_phone = COALESCE(?, tech_contact_phone),
        plan_id = COALESCE(?, plan_id),
        billing_cycle = COALESCE(?, billing_cycle),
        pricing_model = COALESCE(?, pricing_model),
        price_per_student = COALESCE(?, price_per_student),
        custom_price = ?,
        calculated_subscription_amount = COALESCE(?, calculated_subscription_amount),
        grace_period_days = COALESCE(?, grace_period_days),
        auto_suspend_enabled = COALESCE(?, auto_suspend_enabled),
        status = COALESCE(?, status),
        payment_status = COALESCE(?, payment_status),
        active_modules_json = COALESCE(?, active_modules_json),
        subscription_start = COALESCE(?, subscription_start),
        subscription_end = COALESCE(?, subscription_end),
        updated_at = datetime('now')
      WHERE id = ?
    `,
      name ?? null, erp_url ?? null, logo_url ?? null, address ?? null, city ?? null, state ?? null, country ?? null,
      owner_name ?? null, owner_email ?? null, owner_phone ?? null,
      tech_contact_name ?? null, tech_contact_email ?? null, tech_contact_phone ?? null,
      plan_id ?? null, billing_cycle ?? null, pricing_model ?? null,
      price_per_student !== undefined && price_per_student !== null ? parseFloat(price_per_student) : null,
      custom_price ?? null,
      newCalculatedAmount ?? null,
      grace_period_days !== undefined && grace_period_days !== null ? parseInt(grace_period_days, 10) : null,
      auto_suspend_enabled !== undefined && auto_suspend_enabled !== null ? (auto_suspend_enabled ? 1 : 0) : null,
      status ?? null, payment_status ?? null, activeModulesJson ?? null,
      subscription_start ?? null, subscription_end ?? null,
      school.id
    );

    const updatedSchool = db.get('SELECT * FROM schools WHERE id = ?', school.id);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'UPDATE_SCHOOL_PROFILE',
      targetType: 'SCHOOL',
      targetId: school.id,
      details: req.body,
      ip: req.ip
    });

    db.savePermanentSnapshot();

    res.json({
      success: true,
      message: 'School details updated successfully',
      data: updatedSchool
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/schools/batch/check-all-students - Reconcile student census across all schools
router.post('/batch/check-all-students', authenticateToken, (req, res) => {
  try {
    const schools = db.all('SELECT id, name FROM schools WHERE status != "SUSPENDED"');
    const results = [];
    for (const sch of schools) {
      try {
        const rec = automationEngine.reconcileSchoolStudentCensus(sch.id);
        results.push(rec);
      } catch (e) {
        results.push({ schoolId: sch.id, error: e.message });
      }
    }

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'BATCH_CHECK_ALL_STUDENTS',
      targetType: 'SCHOOL_CENSUS',
      details: { schoolsProcessed: results.length },
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Reconciled student census for ${results.length} schools.`,
      data: results
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/schools/:id/sync-now - Synchronize real live census data directly from School ERP
router.post('/:id/sync-now', authenticateToken, async (req, res) => {
  try {
    const school = db.get('SELECT * FROM schools WHERE id = ?', req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    if (!school.erp_url || !school.erp_url.trim()) {
      return res.status(400).json({
        success: false,
        error: `School "${school.name}" does not have a School ERP Base URL configured.`
      });
    }

    const probeResult = await probeLiveSchoolErp({
      erpUrl: school.erp_url,
      schoolId: school.remote_school_id || school.code || school.id,
      apiKey: school.api_key,
      hmacSecret: school.hmac_secret,
      schoolName: school.name
    });

    if (!probeResult.success) {
      db.run("UPDATE schools SET health_status = 'OFFLINE', updated_at = datetime('now') WHERE id = ?", school.id);
      return res.status(502).json({
        success: false,
        error: `Could not fetch live data from ERP (${school.erp_url}): ${probeResult.error}`,
        diagnostic: probeResult.diagnostic
      });
    }

    const data = probeResult.data;
    const metricId = `met-live-${Date.now()}`;

    // Store real live metric
    db.run(
      `INSERT INTO school_sync_metrics (
        id, school_id, total_students, active_students, inactive_students,
        total_teachers, active_teachers, inactive_teachers, non_teaching_staff,
        attendance_rate_pct, sync_source, sync_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LIVE_MANUAL_SYNC', datetime('now'))`,
      metricId, school.id,
      data.totalStudents, data.activeStudents, Math.max(0, data.totalStudents - data.activeStudents),
      data.teachers, data.teachers, 0, data.staff,
      data.attendanceRate
    );

    const rec = automationEngine.reconcileSchoolStudentCensus(school.id);
    db.run("UPDATE schools SET health_status = 'HEALTHY', last_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", school.id);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'ERP_MANUAL_SYNC',
      targetType: 'SCHOOL',
      targetId: school.id,
      details: { students: data.totalStudents, teachers: data.teachers, erpUrl: school.erp_url },
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Successfully synchronized live census from ${school.name}: ${data.totalStudents.toLocaleString()} students, ${data.teachers} teachers (${data.attendanceRate}% attendance).`,
      data: {
        schoolId: school.id,
        schoolName: school.name,
        metrics: data,
        reconciliation: rec
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/schools/:id/check-students - Check latest students from ERP (or last stored) and recalculate amount to pay
router.post('/:id/check-students', authenticateToken, async (req, res) => {
  try {
    const school = db.get('SELECT * FROM schools WHERE id = ?', req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    let liveCheckWarning = null;
    let liveSuccess = false;

    // 1. Attempt live check if erp_url exists
    if (school.erp_url && school.erp_url.trim()) {
      const probeResult = await probeLiveSchoolErp({
        erpUrl: school.erp_url,
        schoolId: school.remote_school_id || school.code || school.id,
        apiKey: school.api_key,
        hmacSecret: school.hmac_secret,
        schoolName: school.name
      });

      if (probeResult.success) {
        liveSuccess = true;
        const data = probeResult.data;
        const metricId = `met-chk-${Date.now()}`;
        db.run(
          `INSERT INTO school_sync_metrics (
            id, school_id, total_students, active_students, inactive_students,
            total_teachers, active_teachers, inactive_teachers, non_teaching_staff,
            attendance_rate_pct, sync_source, sync_timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LIVE_STUDENT_CHECK', datetime('now'))`,
          metricId, school.id,
          data.totalStudents, data.activeStudents, Math.max(0, data.totalStudents - data.activeStudents),
          data.teachers, data.teachers, 0, data.staff,
          data.attendanceRate
        );
        db.run("UPDATE schools SET health_status = 'HEALTHY', last_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", school.id);
      } else {
        liveCheckWarning = `Notice: Could not pull live data from School ERP (${school.erp_url}): ${probeResult.error}. Using last recorded census.`;
      }
    }

    const result = automationEngine.reconcileSchoolStudentCensus(req.params.id);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CHECK_LATEST_STUDENTS',
      targetType: 'SCHOOL',
      targetId: req.params.id,
      details: { ...result, liveCheckWarning, liveSuccess },
      ip: req.ip
    });

    res.json({
      success: true,
      message: liveCheckWarning 
        ? `${liveCheckWarning} Recalculated for ${result.studentCount} students × ₹${result.pricePerStudent}/mo = ₹${result.calculatedAmount.toLocaleString()} to pay.`
        : `Verified latest live census for ${result.schoolName}: ${result.studentCount.toLocaleString()} students × ₹${result.pricePerStudent}/mo = ₹${result.calculatedAmount.toLocaleString()} to pay (${result.billingCycle}).`,
      data: result,
      warning: liveCheckWarning
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/schools/:id - Permanently delete a school and all associated data
router.delete('/:id', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), (req, res) => {
  try {
    const school = db.get('SELECT id, name, code FROM schools WHERE id = ?', req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    db.transaction((tx) => {
      // 1. Delete associated records explicitly
      tx.run('DELETE FROM payments WHERE school_id = ?', school.id);
      tx.run('DELETE FROM invoices WHERE school_id = ?', school.id);
      tx.run('DELETE FROM school_sync_metrics WHERE school_id = ?', school.id);
      tx.run('DELETE FROM remote_commands WHERE school_id = ?', school.id);
      tx.run('DELETE FROM security_events WHERE school_id = ?', school.id);
      tx.run('DELETE FROM system_notifications WHERE school_id = ?', school.id);
      tx.run('DELETE FROM erp_telemetry_history WHERE school_id = ?', school.id);
      tx.run('DELETE FROM email_logs WHERE school_id = ?', school.id);

      // 2. Delete the school entity
      tx.run('DELETE FROM schools WHERE id = ?', school.id);
    });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE_SCHOOL',
      targetType: 'SCHOOL',
      targetId: school.id,
      details: { schoolName: school.name, schoolCode: school.code },
      ip: req.ip
    });

    db.savePermanentSnapshot();

    res.json({
      success: true,
      message: `School "${school.name}" (${school.code}) and all related telemetry, invoices, and credentials have been permanently deleted.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
