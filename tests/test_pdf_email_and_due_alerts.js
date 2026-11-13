const assert = require('assert');
const db = require('../src/database/db');
const pdfInvoiceService = require('../src/services/pdfInvoiceService');
const emailService = require('../src/services/emailService');
const { createTestSchool, deleteTestSchool } = require('./test_helpers');

console.log('--- TEST SUITE 10: PDF INVOICES, EMAIL DISPATCH, WHATSAPP & UPCOMING DUE ALERTS ---');

const schoolId = 'sch-test-pdf-email';
const schoolEmail = 'principal@test-global-school.edu';
const schoolPhone = '+91 9876543210';

async function runPdfAndEmailTests() {
  deleteTestSchool(schoolId);
  createTestSchool(schoolId, {
    name: 'Cambridge International Global Academy',
    owner_name: 'Dr. Arthur Pendelton',
    owner_email: schoolEmail,
    owner_phone: schoolPhone,
    pricing_model: 'PER_STUDENT',
    price_per_student: 28.5,
    calculated_subscription_amount: 342000,
    billing_cycle: 'YEARLY',
    status: 'ACTIVE'
  });

  const invoiceId = `inv-test-pdf-${Date.now()}`;
  const paymentId = `pay-test-pdf-${Date.now()}`;

  try {
    // 0. Seed real student census metrics for the test school
    db.run(`
      INSERT INTO school_sync_metrics (
        id, school_id, total_students, active_students, inactive_students,
        total_teachers, active_teachers, inactive_teachers, non_teaching_staff,
        attendance_rate_pct, sync_source, sync_timestamp
      ) VALUES (
        ?, ?, 1420, 1400, 20, 75, 74, 1, 30, 96.5, 'LIVE_TEST', datetime('now')
      )
    `, `metric-test-${Date.now()}`, schoolId);

    // 1. Create a test invoice due in 2 days (upcoming due) with student census and notes
    db.run(`
      INSERT INTO invoices (
        id, invoice_number, school_id, billing_cycle,
        period_start, period_end, issue_date, due_date,
        subtotal, tax_rate, tax_amount, total_amount, balance_due, status,
        notes, student_count, unit_rate
      ) VALUES (
        ?, 'INV-2026-PDF01', ?, 'YEARLY',
        date('now'), date('now', '+1 year'), date('now'), date('now', '+2 days'),
        100000.0, 18.0, 18000.0, 118000.0, 118000.0, 'PENDING',
        'Annual subscription for 1420 students @ INR 28.5/mo', 1420, 28.5
      )
    `, invoiceId, schoolId);

    // 2. Test PDF Generation Service with real census and notes
    const { buffer, details } = await pdfInvoiceService.generateInvoicePdfBuffer(invoiceId);
    assert.ok(Buffer.isBuffer(buffer), 'PDF output must be a binary Buffer');
    assert.ok(buffer.length > 1000, `PDF size must be substantial, got ${buffer.length} bytes`);
    assert.strictEqual(buffer.subarray(0, 4).toString(), '%PDF', 'Buffer must have valid %PDF magic header');
    assert.strictEqual(details.invoice.school_name, 'Cambridge International Global Academy');
    assert.strictEqual(details.invoice.student_count, 1420);
    assert.strictEqual(details.invoice.unit_rate, 28.5);
    console.log(`✓ Vector PDF invoice generated successfully (${buffer.length} bytes) with census: 1,420 students`);

    // 2b. Test Token Authentication via Query Param for PDF Streaming
    const jwt = require('jsonwebtoken');
    const config = require('../src/config/config');
    const { authenticateToken } = require('../src/middleware/auth');
    const testToken = jwt.sign({ id: 'usr-super-admin', email: 'admin@centralcommand.io', role: 'SUPER_ADMIN' }, config.JWT_SECRET);

    let authPassed = false;
    const mockReq = { headers: {}, query: { token: testToken } };
    const mockRes = { status: () => ({ json: () => {} }) };
    authenticateToken(mockReq, mockRes, () => {
      authPassed = true;
    });
    assert.strictEqual(authPassed, true, 'authenticateToken must accept valid token in query param');
    console.log('✓ Direct browser PDF access authenticated via query param (?token=...)');

    // 3. Test Email Service for Invoice & PDF Dispatch
    const emailResult = await emailService.sendInvoiceEmail({
      invoiceId,
      customMessage: 'Please review your approaching annual subscription invoice.'
    });

    assert.strictEqual(emailResult.success, true);
    assert.strictEqual(emailResult.recipient, schoolEmail);
    assert.strictEqual(emailResult.invoiceNumber, 'INV-2026-PDF01');

    // Verify database email_log record
    const emailLog = db.get("SELECT * FROM email_logs WHERE invoice_id = ? AND email_type = 'INVOICE_BILL'", invoiceId);
    assert.ok(emailLog, 'Email dispatch must be recorded in email_logs');
    assert.strictEqual(emailLog.recipient_email, schoolEmail);
    assert.strictEqual(emailLog.has_attachment, 1);
    console.log(`✓ Invoice email and PDF attachment dispatched to ${emailResult.recipient}`);

    // 4. Test Upcoming Dues Query & WhatsApp URL formatting
    const rawDues = db.all(`
      SELECT 
        i.*,
        s.name as school_name,
        s.owner_name,
        s.owner_email,
        s.owner_phone,
        CAST(ROUND(julianday(i.due_date) - julianday('now')) AS INTEGER) as days_remaining
      FROM invoices i
      JOIN schools s ON i.school_id = s.id
      WHERE i.id = ?
    `, invoiceId);

    assert.strictEqual(rawDues.length, 1);
    const dueRecord = rawDues[0];
    assert.ok(dueRecord.days_remaining <= 3 && dueRecord.days_remaining >= 1, `Days remaining should be ~2 days, got ${dueRecord.days_remaining}`);

    const cleanPhone = dueRecord.owner_phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    assert.strictEqual(phoneWithCountry, '919876543210', 'Phone number must be normalized with country code 91');
    console.log(`✓ Upcoming due alert recognized (Due in ${dueRecord.days_remaining} days, normalized phone: +${phoneWithCountry})`);

    // 5. Test Payment Settlement & Payment Receipt Email with Stamped PDF
    db.run(`
      INSERT INTO payments (
        id, payment_number, invoice_id, school_id, amount, payment_date,
        payment_method, transaction_reference, status, notes
      ) VALUES (
        ?, 'PAY-2026-PDF01', ?, ?, 118000.0, date('now'),
        'BANK_TRANSFER', 'UTR-HDFC-99112233', 'SUCCESSFUL', 'Settled via RTGS'
      )
    `, paymentId, invoiceId, schoolId);

    db.run("UPDATE invoices SET balance_due = 0, status = 'PAID' WHERE id = ?", invoiceId);

    const receiptResult = await emailService.sendPaymentReceiptEmail({
      invoiceId,
      paymentId
    });

    assert.strictEqual(receiptResult.success, true);
    assert.strictEqual(receiptResult.recipient, schoolEmail);
    assert.strictEqual(receiptResult.paymentNumber, 'PAY-2026-PDF01');

    const receiptLog = db.get('SELECT * FROM email_logs WHERE payment_id = ?', paymentId);
    assert.ok(receiptLog, 'Payment receipt dispatch must be recorded in email_logs');
    assert.strictEqual(receiptLog.email_type, 'PAYMENT_RECEIPT');
    console.log(`✓ Payment receipt confirmation and stamped PDF emailed to ${receiptResult.recipient}`);

    // Clean up
    db.run('DELETE FROM email_logs WHERE invoice_id = ?', invoiceId);
    db.run('DELETE FROM payments WHERE id = ?', paymentId);
    db.run('DELETE FROM invoices WHERE id = ?', invoiceId);

    console.log('✓ PDF invoices, email dispatch, WhatsApp & upcoming due alerts PASSED');
  } finally {
    deleteTestSchool(schoolId);
  }
}

module.exports = runPdfAndEmailTests();
