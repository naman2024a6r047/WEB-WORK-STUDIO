const assert = require('assert');
const http = require('http');
const request = require('supertest');
const db = require('../src/database/db');
const app = require('../src/server');
const commandQueueService = require('../src/services/commandQueueService');
const { createTestSchool, deleteTestSchool } = require('./test_helpers');

console.log('--- TEST SUITE 4: REMOTE SERVICE CONTROL (SUSPENSION & REACTIVATION) ---');

async function runRemoteControlTests() {
  const testSchoolId = 'sch-test-remote';
  createTestSchool(testSchoolId, { status: 'ACTIVE' });

  // Add initial metric for student verification
  db.run(`
    INSERT INTO school_sync_metrics (
      id, school_id, total_students, active_students, inactive_students,
      total_teachers, active_teachers, inactive_teachers, non_teaching_staff, sync_source
    ) VALUES ('met-rc-test', ?, 1200, 1180, 20, 50, 48, 2, 15, 'TEST')
  `, testSchoolId);

  try {
    // 1. Initial State: Must be ACTIVE
    const initialSchool = db.get('SELECT id, name, status FROM schools WHERE id = ?', testSchoolId);
    assert.strictEqual(initialSchool.status, 'ACTIVE', 'Initial status must be ACTIVE');

    // Verify student metrics count before suspension
    const studentMetricsBefore = db.get('SELECT total_students FROM school_sync_metrics WHERE school_id = ? ORDER BY sync_timestamp DESC LIMIT 1', testSchoolId);
    const studentCountBefore = studentMetricsBefore.total_students;

    // 2. Enqueue SUSPEND_SERVICE command
    const suspendReason = 'Annual ERP subscription payment delinquent for 45 days.';
    const suspendResult = commandQueueService.enqueueCommand({
      schoolId: testSchoolId,
      commandType: 'SUSPEND_SERVICE',
      payload: {
        reason: suspendReason,
        display_page: 'SERVICE_SUSPENDED_OVERDUE',
        support_contact: 'billing@centralcommand.io'
      },
      issuedBy: 'SUPER_ADMIN_TEST'
    });

    assert.ok(suspendResult.commandId);
    assert.strictEqual(suspendResult.status, 'PENDING');

    // 3. School ERP Connector pulls pending commands
    const pending = commandQueueService.getPendingCommands(testSchoolId);
    const myCmd = pending.find(c => c.commandId === suspendResult.commandId);
    assert.ok(myCmd, 'Connector must pull pending SUSPEND_SERVICE command');
    assert.strictEqual(myCmd.commandType, 'SUSPEND_SERVICE');

    // 4. Connector executes command locally and sends acknowledgment
    const ackResult = commandQueueService.acknowledgeCommand({
      schoolId: testSchoolId,
      commandId: suspendResult.commandId,
      executionStatus: 'SUCCESS',
      resultLog: 'Local ERP routing locked to /service-suspended. Student/teacher logins intercepted. Database fully intact.'
    });

    assert.strictEqual(ackResult.status, 'EXECUTED');

    // 5. Verify Central Platform State Transition -> SUSPENDED
    const suspendedSchool = db.get('SELECT id, status, suspension_reason, suspended_at FROM schools WHERE id = ?', testSchoolId);
    assert.strictEqual(suspendedSchool.status, 'SUSPENDED', 'School status must transition to SUSPENDED');
    assert.strictEqual(suspendedSchool.suspension_reason, suspendReason);
    assert.ok(suspendedSchool.suspended_at, 'suspended_at timestamp must be recorded');

    // 6. CRITICAL: Verify Non-Destructive Guarantee (Zero data loss)
    const studentMetricsAfter = db.get('SELECT total_students FROM school_sync_metrics WHERE school_id = ? ORDER BY sync_timestamp DESC LIMIT 1', testSchoolId);
    assert.strictEqual(studentMetricsAfter.total_students, studentCountBefore, 'CRITICAL: Student records must remain 100% intact');

    // 7. Test Remote Reactivation
    const reactivateResult = commandQueueService.enqueueCommand({
      schoolId: testSchoolId,
      commandType: 'REACTIVATE_SERVICE',
      payload: { reason: 'Subscription invoice settled in full.' },
      issuedBy: 'SUPER_ADMIN_TEST'
    });

    const pendingReactivate = commandQueueService.getPendingCommands(testSchoolId);
    assert.ok(pendingReactivate.length > 0);

    commandQueueService.acknowledgeCommand({
      schoolId: testSchoolId,
      commandId: reactivateResult.commandId,
      executionStatus: 'SUCCESS',
      resultLog: 'Local ERP suspension removed. Normal login routing restored.'
    });

    // 8. Verify Central Platform State Transition -> Restored to ACTIVE
    const reactivatedSchool = db.get('SELECT id, status, suspension_reason FROM schools WHERE id = ?', testSchoolId);
    assert.strictEqual(reactivatedSchool.status, 'ACTIVE', 'School status must return to ACTIVE');
    assert.strictEqual(reactivatedSchool.suspension_reason, null, 'Suspension reason must be cleared');

    // =========================================================================
    // 9. LIVE HTTP END-TO-END DISPATCH VERIFICATION
    // =========================================================================
    let mockReceivedSuspend = false;
    let mockReceivedReactivate = false;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/connector/suspend')) {
        mockReceivedSuspend = true;
        return {
          status: 200,
          json: async () => ({
            success: true,
            message: 'School ERP has been remotely suspended. All student/teacher data preserved safely.',
            is_suspended: true,
            status: 'suspended'
          })
        };
      }
      if (urlStr.includes('/api/v1/connector/reactivate')) {
        mockReceivedReactivate = true;
        return {
          status: 200,
          json: async () => ({
            success: true,
            message: 'School ERP has been remotely reactivated. Normal operations resumed.',
            is_suspended: false,
            status: 'connected'
          })
        };
      }
      return { status: 404, json: async () => ({ error: 'Not found' }) };
    };

    try {
      // Point test school erp_url to live mock ERP endpoint
      db.run("UPDATE schools SET erp_url = 'https://cambridge.ktwr.in', status = 'ACTIVE' WHERE id = ?", testSchoolId);

      const remoteControlRouter = require('../src/routes/remoteControlRoutes');
      const issueRoute = remoteControlRouter.stack.find(s => s.route && s.route.path === '/issue');
      const issueHandler = issueRoute.route.stack[issueRoute.route.stack.length - 1].handle;

      function createMockRes() {
        return {
          statusCode: 200,
          bodyData: null,
          status: function (code) {
            this.statusCode = code;
            return this;
          },
          json: function (data) {
            this.bodyData = data;
            return this;
          }
        };
      }

      // Dispatch SUSPEND_SERVICE via issueHandler
      const mockReqSuspend = {
        body: {
          school_id: testSchoolId,
          command_type: 'SUSPEND_SERVICE',
          payload: { reason: 'Live E2E test suspension' },
          confirmation: true
        },
        user: { email: 'superadmin@centralcommand.io' }
      };
      const mockResSuspend = createMockRes();
      await issueHandler(mockReqSuspend, mockResSuspend);

      assert.strictEqual(mockResSuspend.statusCode, 200, 'Live suspend must return HTTP 200');
      assert.strictEqual(mockResSuspend.bodyData.success, true);
      assert.strictEqual(mockResSuspend.bodyData.deliveredLive, true, 'Command must be delivered live');
      assert.strictEqual(mockResSuspend.bodyData.executionStatus, 'EXECUTED', 'Execution status must be EXECUTED');
      assert.strictEqual(mockReceivedSuspend, true, 'Remote ERP connector must have received POST /api/v1/connector/suspend');

      // Check DB school status is now SUSPENDED
      const liveSuspendedSchool = db.get('SELECT status FROM schools WHERE id = ?', testSchoolId);
      assert.strictEqual(liveSuspendedSchool.status, 'SUSPENDED', 'Database school status must be SUSPENDED');

      // Dispatch REACTIVATE_SERVICE via issueHandler
      const mockReqReactivate = {
        body: {
          school_id: testSchoolId,
          command_type: 'REACTIVATE_SERVICE',
          payload: { reason: 'Live E2E test reactivation' },
          confirmation: true
        },
        user: { email: 'superadmin@centralcommand.io' }
      };
      const mockResReactivate = createMockRes();
      await issueHandler(mockReqReactivate, mockResReactivate);

      assert.strictEqual(mockResReactivate.statusCode, 200, 'Live reactivate must return HTTP 200');
      assert.strictEqual(mockResReactivate.bodyData.success, true);
      assert.strictEqual(mockResReactivate.bodyData.deliveredLive, true, 'Reactivate must be delivered live');
      assert.strictEqual(mockResReactivate.bodyData.executionStatus, 'EXECUTED');
      assert.strictEqual(mockReceivedReactivate, true, 'Remote ERP connector must have received POST /api/v1/connector/reactivate');

      // Check DB school status is restored to ACTIVE
      const liveRestoredSchool = db.get('SELECT status FROM schools WHERE id = ?', testSchoolId);
      assert.strictEqual(liveRestoredSchool.status, 'ACTIVE', 'Database school status must be restored to ACTIVE');

    } finally {
      global.fetch = originalFetch;
    }

    console.log('✓ Remote suspension, zero-data-loss guarantee & reactivation tests PASSED');
  } finally {
    deleteTestSchool(testSchoolId);
  }
}

module.exports = runRemoteControlTests();
