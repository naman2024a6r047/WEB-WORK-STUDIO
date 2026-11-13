const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/auditLogger');
const pdfInvoiceService = require('../services/pdfInvoiceService');
const emailService = require('../services/emailService');

// GET /api/v1/invoices - List invoices with filters
router.get('/', authenticateToken, (req, res) => {
  try {
    const { school_id, status } = req.query;

    let sql = `
      SELECT 
        i.*,
        s.name as school_name,
        s.code as school_code,
        s.owner_email,
        s.owner_phone,
        p.name as plan_name
      FROM invoices i
      JOIN schools s ON i.school_id = s.id
      LEFT JOIN subscription_plans p ON i.plan_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (school_id) {
      sql += ' AND i.school_id = ?';
      params.push(school_id);
    }
    if (status) {
      sql += ' AND i.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY i.issue_date DESC';

    const invoices = db.all(sql, ...params);
    res.json({ success: true, count: invoices.length, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/invoices/upcoming-dues - Upcoming payment due alerts (next 2-3 days & overdue)
router.get('/upcoming-dues', authenticateToken, (req, res) => {
  try {
    const { cycle, max_days = 3 } = req.query;
    const maxDaysNum = parseFloat(max_days) || 3;

    let sql = `
      SELECT 
        i.id,
        i.invoice_number,
        i.school_id,
        i.billing_cycle,
        i.period_start,
        i.period_end,
        i.issue_date,
        i.due_date,
        i.subtotal,
        i.tax_amount,
        i.total_amount,
        i.balance_due,
        i.status,
        i.reminder_sent_at,
        s.name as school_name,
        s.code as school_code,
        s.remote_school_id,
        s.owner_name,
        s.owner_email,
        s.owner_phone,
        s.pricing_model,
        s.price_per_student,
        s.calculated_subscription_amount,
        p.name as plan_name,
        CAST(ROUND(julianday(i.due_date) - julianday('now')) AS INTEGER) as days_remaining
      FROM invoices i
      JOIN schools s ON i.school_id = s.id
      LEFT JOIN subscription_plans p ON i.plan_id = p.id
      WHERE i.status IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
        AND i.balance_due > 0
        AND (julianday(i.due_date) - julianday('now')) <= ?
    `;
    const params = [maxDaysNum];

    if (cycle && cycle !== 'ALL') {
      sql += ' AND i.billing_cycle = ?';
      params.push(cycle);
    }

    sql += ' ORDER BY days_remaining ASC, i.due_date ASC';

    const rawDues = db.all(sql, ...params);

    const formatted = rawDues.map(d => {
      let urgency = 'NORMAL';
      let urgencyLabel = `Due in ${d.days_remaining} days`;
      if (d.days_remaining < 0) {
        urgency = 'OVERDUE';
        urgencyLabel = `Overdue by ${Math.abs(d.days_remaining)} days`;
      } else if (d.days_remaining === 0) {
        urgency = 'TODAY';
        urgencyLabel = 'Due Today';
      } else if (d.days_remaining === 1) {
        urgency = 'TOMORROW';
        urgencyLabel = 'Due Tomorrow';
      } else if (d.days_remaining <= 3) {
        urgency = 'UPCOMING';
        urgencyLabel = `Due in ${d.days_remaining} days`;
      }

      // Pre-format WhatsApp Click-to-Chat URL
      const cleanPhone = (d.owner_phone || '').replace(/[^0-9]/g, '');
      const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      
      const waText = encodeURIComponent(
        `Hello ${d.owner_name || 'School Principal'},\n\n` +
        `This is an official payment notice from Central ERP Command regarding *${d.school_name}*.\n\n` +
        `• Invoice No: *${d.invoice_number}*\n` +
        `• Plan: ${d.plan_name || 'Growth Academy Pro'} (${d.billing_cycle})\n` +
        `• Total Amount Due: *₹${(d.balance_due || 0).toLocaleString('en-IN')}*\n` +
        `• Due Date: *${d.due_date}* (${urgencyLabel})\n\n` +
        `*Settlement Bank Details:*\n` +
        `Bank: HDFC Bank Ltd (Current Account)\n` +
        `Beneficiary: Central ERP Command Solutions Pvt Ltd\n` +
        `A/C: 50200088991122 | IFSC: HDFC0001234\n` +
        `Instant UPI VPA: centralerp@hdfcbank\n\n` +
        `Please share the payment UTR / reference once transferred to update your account.`
      );

      const waUrl = phoneWithCountry ? `https://wa.me/${phoneWithCountry}?text=${waText}` : null;

      return {
        ...d,
        urgency,
        urgency_label: urgencyLabel,
        whatsapp_url: waUrl,
        whatsapp_phone: phoneWithCountry
      };
    });

    res.json({
      success: true,
      count: formatted.length,
      cycleFilter: cycle || 'ALL',
      data: formatted
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/invoices/all-payments - List all payment transactions
router.get('/data/payments', authenticateToken, (req, res) => {
  try {
    const payments = db.all(`
      SELECT p.*, i.invoice_number, s.name as school_name, s.code as school_code
      FROM payments p
      JOIN schools s ON p.school_id = s.id
      LEFT JOIN invoices i ON p.invoice_id = i.id
      ORDER BY p.payment_date DESC
    `);
    res.json({ success: true, count: payments.length, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/invoices/:id/pdf - Stream official PDF invoice
router.get('/:id/pdf', authenticateToken, (req, res) => {
  try {
    const isDownload = req.query.download === 'true' || req.query.attachment === 'true';
    pdfInvoiceService.generateInvoicePdfStream(req.params.id, res, isDownload);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/invoices/:id/send-email - Send official PDF invoice via email to school owner
router.post('/:id/send-email', authenticateToken, requireRole(['SUPER_ADMIN', 'FINANCE_OFFICER', 'OPERATIONS']), async (req, res) => {
  try {
    const result = await emailService.sendInvoiceEmail({
      invoiceId: req.params.id,
      customMessage: req.body.message
    });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'SEND_INVOICE_EMAIL',
      targetType: 'INVOICE',
      targetId: req.params.id,
      details: { recipient: result.recipient, invoiceNumber: result.invoiceNumber },
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Invoice ${result.invoiceNumber} and official PDF attachment successfully emailed to ${result.recipient}!`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/invoices/:id - Detailed invoice with payments
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const invoice = db.get(`
      SELECT 
        i.*,
        s.name as school_name,
        s.code as school_code,
        s.address as school_address,
        s.city as school_city,
        s.state as school_state,
        s.owner_name,
        s.owner_email,
        s.owner_phone,
        p.name as plan_name
      FROM invoices i
      JOIN schools s ON i.school_id = s.id
      LEFT JOIN subscription_plans p ON i.plan_id = p.id
      WHERE i.id = ?
    `, req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const payments = db.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC', invoice.id);

    res.json({
      success: true,
      data: {
        invoice,
        payments
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/invoices - Generate new invoice
router.post('/', authenticateToken, requireRole(['SUPER_ADMIN', 'FINANCE_OFFICER']), (req, res) => {
  try {
    const { 
      school_id, 
      plan_id, 
      billing_cycle, 
      period_start, 
      period_end, 
      subtotal, 
      tax_rate = 18.0, 
      due_date, 
      notes,
      student_count,
      unit_rate
    } = req.body;

    if (!school_id || !subtotal || !due_date || !period_start || !period_end) {
      return res.status(400).json({
        success: false,
        error: 'school_id, subtotal, due_date, period_start, and period_end are required'
      });
    }

    const school = db.get('SELECT id, name, plan_id, billing_cycle, pricing_model, price_per_student FROM schools WHERE id = ?', school_id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    let finalStudents = (student_count !== undefined && student_count !== null && student_count !== '') 
      ? parseInt(student_count, 10) 
      : 0;
    let finalRate = (unit_rate !== undefined && unit_rate !== null && unit_rate !== '') 
      ? parseFloat(unit_rate) 
      : (school.price_per_student || 25.0);

    if (!finalStudents && school.pricing_model === 'PER_STUDENT') {
      const metric = db.get(
        'SELECT total_students, active_students FROM school_sync_metrics WHERE school_id = ? ORDER BY sync_timestamp DESC, rowid DESC LIMIT 1',
        school.id
      );
      if (metric) {
        finalStudents = metric.total_students || metric.active_students || 0;
      }
    }

    const invoiceNum = `INV-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const invoiceId = `inv-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const numSubtotal = parseFloat(subtotal);
    const numTaxRate = parseFloat(tax_rate);
    const taxAmount = (numSubtotal * numTaxRate) / 100;
    const totalAmount = numSubtotal + taxAmount;
    const balanceDue = totalAmount;

    db.run(`
      INSERT INTO invoices (
        id, invoice_number, school_id, plan_id, billing_cycle, period_start, period_end,
        issue_date, due_date, subtotal, tax_rate, tax_amount, total_amount, balance_due, status, notes,
        student_count, unit_rate
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        date('now'), ?, ?, ?, ?, ?, ?, 'PENDING', ?,
        ?, ?
      )
    `,
      invoiceId, invoiceNum, school.id, plan_id || school.plan_id, billing_cycle || school.billing_cycle,
      period_start, period_end, due_date, numSubtotal, numTaxRate, taxAmount, totalAmount, balanceDue, notes || '',
      finalStudents, finalRate
    );

    // Update school payment_status to PENDING if currently PAID
    db.run("UPDATE schools SET payment_status = 'PENDING' WHERE id = ? AND payment_status = 'PAID'", school.id);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'GENERATE_INVOICE',
      targetType: 'INVOICE',
      targetId: invoiceId,
      details: { invoiceNum, totalAmount, schoolId: school.id },
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Invoice generated successfully',
      data: { invoiceId, invoiceNum, totalAmount }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/invoices/:id/payments - Record payment and automatically send payment receipt email with stamped PDF
router.post('/:id/payments', authenticateToken, requireRole(['SUPER_ADMIN', 'FINANCE_OFFICER']), async (req, res) => {
  try {
    const { amount, payment_method = 'BANK_TRANSFER', transaction_reference, notes, payment_date = new Date().toISOString().slice(0, 10) } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Valid payment amount is required' });
    }

    const invoice = db.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const payAmount = parseFloat(amount);
    const newBalance = Math.max(0, invoice.balance_due - payAmount);
    const newStatus = newBalance === 0 ? 'PAID' : (newBalance < invoice.total_amount ? 'PARTIALLY_PAID' : invoice.status);

    const paymentNum = `PAY-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const paymentId = `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    db.transaction((tx) => {
      // 1. Record payment
      tx.run(`
        INSERT INTO payments (
          id, payment_number, invoice_id, school_id, amount, payment_date,
          payment_method, transaction_reference, status, recorded_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESSFUL', ?, ?)
      `,
        paymentId, paymentNum, invoice.id, invoice.school_id, payAmount, payment_date,
        payment_method, transaction_reference || `REF-${Date.now()}`, req.user.id, notes || ''
      );

      // 2. Update invoice balance and status
      tx.run(
        'UPDATE invoices SET balance_due = ?, status = ?, updated_at = datetime("now") WHERE id = ?',
        newBalance, newStatus, invoice.id
      );

      // 3. Check if all invoices for school are now settled
      const remainingDues = tx.get(
        "SELECT SUM(balance_due) as remaining FROM invoices WHERE school_id = ? AND status IN ('OVERDUE', 'PENDING', 'PARTIALLY_PAID')",
        invoice.school_id
      );

      if (!remainingDues || remainingDues.remaining <= 0) {
        tx.run("UPDATE schools SET payment_status = 'PAID' WHERE id = ?", invoice.school_id);
      }
    });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'RECORD_PAYMENT',
      targetType: 'PAYMENT',
      targetId: paymentId,
      details: { invoiceId: invoice.id, amount: payAmount, paymentNum },
      ip: req.ip
    });

    // Auto-dispatch payment receipt confirmation email with updated PDF
    let emailDispatched = false;
    let emailRecipient = null;
    let emailError = null;

    try {
      const emailResult = await emailService.sendPaymentReceiptEmail({
        invoiceId: invoice.id,
        paymentId
      });
      emailDispatched = true;
      emailRecipient = emailResult.recipient;
    } catch (emlErr) {
      console.warn('[Payment Receipt Email Dispatch Error]', emlErr.message);
      emailError = emlErr.message;
    }

    res.json({
      success: true,
      message: `Payment of ₹${payAmount.toLocaleString('en-IN')} recorded successfully!${emailDispatched ? ` Official receipt and stamped PDF invoice emailed to ${emailRecipient}.` : ''}`,
      data: {
        paymentId,
        paymentNum,
        paidAmount: payAmount,
        remainingBalance: newBalance,
        invoiceStatus: newStatus,
        emailDispatched,
        emailRecipient,
        emailError
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/invoices/:id/remind - Send payment reminder
router.post('/:id/remind', authenticateToken, requireRole(['SUPER_ADMIN', 'FINANCE_OFFICER']), async (req, res) => {
  try {
    const result = await emailService.sendInvoiceEmail({
      invoiceId: req.params.id,
      customMessage: 'Kindly arrange settlement of this subscription invoice at your earliest convenience to maintain continuous service.'
    });

    res.json({
      success: true,
      message: `Payment reminder and PDF invoice successfully emailed to ${result.recipient} for ${result.invoiceNumber}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

module.exports = router;
