const PDFDocument = require('pdfkit');
const db = require('../database/db');

class PdfInvoiceService {
  /**
   * Fetch complete invoice context with school, plan, and payment details
   */
  getInvoiceDetails(invoiceId) {
    const invoice = db.get(`
      SELECT 
        i.*,
        s.name as school_name,
        s.code as school_code,
        s.remote_school_id,
        s.pricing_model,
        s.price_per_student,
        s.calculated_subscription_amount,
        s.address as school_address,
        s.city as school_city,
        s.state as school_state,
        s.country as school_country,
        s.owner_name,
        s.owner_email,
        s.owner_phone,
        p.name as plan_name,
        p.monthly_price as plan_monthly_price,
        m.total_students,
        m.active_students
      FROM invoices i
      JOIN schools s ON i.school_id = s.id
      LEFT JOIN subscription_plans p ON i.plan_id = p.id
      LEFT JOIN (
        SELECT school_id, total_students, active_students
        FROM school_sync_metrics
        WHERE school_id = (SELECT school_id FROM invoices WHERE id = ?)
        ORDER BY sync_timestamp DESC, rowid DESC LIMIT 1
      ) m ON s.id = m.school_id
      WHERE i.id = ?
    `, invoiceId, invoiceId);

    if (!invoice) return null;

    const payments = db.all(`
      SELECT * FROM payments 
      WHERE invoice_id = ? AND status = 'SUCCESSFUL'
      ORDER BY payment_date ASC
    `, invoice.id);

    return { invoice, payments };
  }

  /**
   * Build the visual PDF invoice document using PDFKit
   */
  buildPdfDocument(doc, { invoice, payments }) {
    const primaryColor = '#1d4ed8'; // Royal Blue
    const darkText = '#0f172a';
    const mutedText = '#64748b';
    const borderColor = '#e2e8f0';
    const successGreen = '#16a34a';
    const alertRed = '#dc2626';

    const formatCurrency = (val) => `INR ${(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Top Header Banner
    doc.rect(0, 0, 612, 18).fill(primaryColor);

    // 1. Brand Logo & Title
    doc.fillColor(primaryColor)
       .fontSize(20)
       .font('Helvetica-Bold')
       .text('CENTRAL ERP COMMAND', 40, 36);

    doc.fillColor(mutedText)
       .fontSize(8.5)
       .font('Helvetica')
       .text('Multi-School SaaS Management & Cloud ERP Telemetry Platform', 40, 58);

    // Status Badge & Invoice Header right-aligned
    const statusText = invoice.status.toUpperCase();
    const statusColor = statusText === 'PAID' ? successGreen : (statusText === 'OVERDUE' ? alertRed : primaryColor);

    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(statusColor)
       .text(statusText === 'PAID' ? 'TAX INVOICE [PAID]' : 'TAX INVOICE', 360, 36, { align: 'right', width: 212 });

    doc.fontSize(9)
       .font('Helvetica')
       .fillColor(mutedText)
       .text(`Invoice No: ${invoice.invoice_number}`, 360, 56, { align: 'right', width: 212 })
       .text(`Issue Date: ${invoice.issue_date}`, 360, 68, { align: 'right', width: 212 })
       .text(`Due Date: ${invoice.due_date}`, 360, 80, { align: 'right', width: 212 });

    // Divider
    doc.strokeColor(borderColor).lineWidth(1).moveTo(40, 98).lineTo(572, 98).stroke();

    // 2. Billing Parties (Seller & Buyer)
    const partyY = 108;

    // Seller (Left)
    doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('BILLED BY / SERVICE PROVIDER:', 40, partyY);
    doc.fillColor(darkText).fontSize(9.5).font('Helvetica-Bold').text('Central ERP Command Solutions Pvt Ltd', 40, partyY + 14);
    doc.fillColor(darkText).fontSize(8.5).font('Helvetica')
       .text('GSTIN: 27AABCC9900D1Z5', 40, partyY + 28)
       .text('Cyber Heights IT Park, Viman Nagar', 40, partyY + 40)
       .text('Pune, Maharashtra 411014, India', 40, partyY + 52)
       .text('Email: billing@centralcommand.io | +91 20 4000 8888', 40, partyY + 64);

    // Buyer (Right)
    doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('BILLED TO / INSTITUTION DETAILS:', 330, partyY);
    doc.fillColor(darkText).fontSize(9.5).font('Helvetica-Bold').text(invoice.school_name, 330, partyY + 14);
    doc.fillColor(darkText).fontSize(8.5).font('Helvetica')
       .text(`School ID: ${invoice.school_code || invoice.school_id}${invoice.remote_school_id ? ` (Remote: ${invoice.remote_school_id})` : ''}`, 330, partyY + 28)
       .text(`Contact Person: ${invoice.owner_name || 'School Principal'}`, 330, partyY + 40)
       .text(`Email: ${invoice.owner_email || 'Not Specified'}`, 330, partyY + 52)
       .text(`Phone: ${invoice.owner_phone || 'Not Specified'}`, 330, partyY + 64)
       .text(`Campus: ${invoice.school_city || 'City'}, ${invoice.school_state || 'State'}, ${invoice.school_country || 'India'}`, 330, partyY + 76);

    // 3. Subscription Cycle Context Box
    const boxY = 202;
    doc.rect(40, boxY, 532, 28).fill('#f8fafc');
    doc.strokeColor(borderColor).rect(40, boxY, 532, 28).stroke();

    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
       .text(`Subscription Plan: ${invoice.plan_name || 'Custom SaaS Tier'}`, 50, boxY + 8);

    doc.fillColor(mutedText).font('Helvetica')
       .text(`Billing Cycle: ${invoice.billing_cycle}`, 250, boxY + 8)
       .text(`Service Period: ${invoice.period_start} to ${invoice.period_end}`, 380, boxY + 8);

    // 4. Line Items Table Header
    const tableHeaderY = 242;
    doc.rect(40, tableHeaderY, 532, 22).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
    doc.text('#', 50, tableHeaderY + 6);
    doc.text('Description / Service Item', 75, tableHeaderY + 6);
    doc.text('Census / Tier', 330, tableHeaderY + 6);
    doc.text('Rate', 420, tableHeaderY + 6);
    doc.text('Taxable Amount', 490, tableHeaderY + 6, { align: 'right', width: 72 });

    // Line Item Rows
    let rowY = tableHeaderY + 24;
    const isPerStudent = invoice.pricing_model === 'PER_STUDENT';
    let studentCount = invoice.student_count || invoice.total_students || invoice.active_students || 0;
    if (!studentCount && invoice.notes) {
      const match = invoice.notes.match(/(\d+)\s*students?/i);
      if (match) studentCount = parseInt(match[1], 10);
    }
    const studentRate = invoice.unit_rate || invoice.price_per_student || 25.0;

    doc.rect(40, rowY, 532, 42).fill('#ffffff');
    doc.strokeColor(borderColor).lineWidth(0.75).rect(40, rowY, 532, 42).stroke();

    doc.fillColor(darkText).fontSize(8.5).font('Helvetica-Bold');
    doc.text('1', 50, rowY + 8);
    doc.text(`Central ERP Remote Management Platform - Cloud Access`, 75, rowY + 8);

    doc.font('Helvetica').fontSize(7.5).fillColor(mutedText);
    const subDesc = isPerStudent
      ? `Dynamic Student Census Pricing (${studentCount > 0 ? `${studentCount.toLocaleString('en-IN')} enrolled students` : 'Student Census'} × INR ${studentRate}/mo × billing multiplier)`
      : `Standard Tier License for campus administration, student information, and telemetry synchronization`;
    doc.text(subDesc, 75, rowY + 22, { width: 245 });

    doc.fontSize(8.5).fillColor(darkText);
    doc.text(isPerStudent ? `${studentCount > 0 ? studentCount.toLocaleString('en-IN') : 'N/A'} Students` : (invoice.plan_name || 'Flat Tier'), 330, rowY + 8);
    doc.text(isPerStudent ? `INR ${studentRate}/mo` : `Fixed`, 420, rowY + 8);
    doc.text(formatCurrency(invoice.subtotal), 490, rowY + 8, { align: 'right', width: 72 });

    rowY += 46;

    // 5. Financial Summary / Tax Calculation Box
    const summaryStartY = rowY + 8;
    const summaryBoxX = 350;
    const summaryWidth = 222;

    // Subtotal
    doc.fontSize(8.5).font('Helvetica').fillColor(mutedText).text('Subtotal (Net of Taxes):', summaryBoxX, summaryStartY);
    doc.font('Helvetica-Bold').fillColor(darkText).text(formatCurrency(invoice.subtotal), summaryBoxX + 90, summaryStartY, { align: 'right', width: 132 });

    // CGST & SGST (or GST)
    const halfTax = (invoice.tax_amount || 0) / 2;
    doc.font('Helvetica').fillColor(mutedText).text('CGST (9.0%):', summaryBoxX, summaryStartY + 16);
    doc.font('Helvetica').fillColor(darkText).text(formatCurrency(halfTax), summaryBoxX + 90, summaryStartY + 16, { align: 'right', width: 132 });

    doc.font('Helvetica').fillColor(mutedText).text('SGST (9.0%):', summaryBoxX, summaryStartY + 30);
    doc.font('Helvetica').fillColor(darkText).text(formatCurrency(halfTax), summaryBoxX + 90, summaryStartY + 30, { align: 'right', width: 132 });

    // Total Amount Box
    doc.rect(summaryBoxX, summaryStartY + 46, summaryWidth, 24).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica-Bold');
    doc.text('TOTAL AMOUNT:', summaryBoxX + 8, summaryStartY + 53);
    doc.text(formatCurrency(invoice.total_amount), summaryBoxX + 90, summaryStartY + 53, { align: 'right', width: 124 });

    // Paid & Balance Due
    const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    doc.fillColor(successGreen).fontSize(8.5).font('Helvetica-Bold').text('Amount Paid / Settled:', summaryBoxX, summaryStartY + 76);
    doc.text(formatCurrency(totalPaid), summaryBoxX + 90, summaryStartY + 76, { align: 'right', width: 132 });

    doc.fillColor(invoice.balance_due > 0 ? alertRed : successGreen).fontSize(9.5).font('Helvetica-Bold').text('BALANCE DUE:', summaryBoxX, summaryStartY + 92);
    doc.text(formatCurrency(invoice.balance_due), summaryBoxX + 90, summaryStartY + 92, { align: 'right', width: 132 });

    // 6. Bank Details & Payment Instructions (Left column beside totals)
    const bankBoxY = summaryStartY;
    doc.rect(40, bankBoxY, 290, 108).fill('#f8fafc');
    doc.strokeColor(borderColor).rect(40, bankBoxY, 290, 108).stroke();

    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('OFFICIAL SETTLEMENT BANK & UPI DETAILS', 50, bankBoxY + 8);
    doc.fillColor(darkText).fontSize(8).font('Helvetica')
       .text('Beneficiary: Central ERP Command Solutions Pvt Ltd', 50, bankBoxY + 24)
       .text('Bank Name: HDFC Bank Ltd (Current Account)', 50, bankBoxY + 38)
       .text('Account No: 50200088991122', 50, bankBoxY + 52)
       .text('IFSC Code: HDFC0001234', 50, bankBoxY + 66)
       .text('UPI VPA: centralerp@hdfcbank', 50, bankBoxY + 80)
       .text('Remarks: Mention invoice number in transfer narration', 50, bankBoxY + 94);

    // 7. Payment History Ledger (If payments have been made)
    let nextY = bankBoxY + 120;
    if (payments.length > 0) {
      doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('PAYMENT RECEIPT AUDIT TRAIL', 40, nextY);
      nextY += 12;

      doc.rect(40, nextY, 532, 16).fill('#e2e8f0');
      doc.fillColor(darkText).fontSize(7.5).font('Helvetica-Bold');
      doc.text('Receipt #', 48, nextY + 4);
      doc.text('Payment Date', 140, nextY + 4);
      doc.text('Mode', 230, nextY + 4);
      doc.text('Transaction Ref / UTR', 310, nextY + 4);
      doc.text('Amount Credited', 470, nextY + 4, { align: 'right', width: 92 });

      nextY += 18;
      payments.forEach(p => {
        doc.rect(40, nextY, 532, 16).fill('#f8fafc');
        doc.fillColor(darkText).fontSize(7.5).font('Helvetica');
        doc.text(p.payment_number, 48, nextY + 4);
        doc.text(p.payment_date, 140, nextY + 4);
        doc.text(p.payment_method, 230, nextY + 4);
        doc.text(p.transaction_reference || 'REF-N/A', 310, nextY + 4);
        doc.fillColor(successGreen).font('Helvetica-Bold').text(formatCurrency(p.amount), 470, nextY + 4, { align: 'right', width: 92 });
        nextY += 18;
      });
      nextY += 8;
    }

    // 8. Footer Notes & Authorization Stamp
    const footerY = Math.max(nextY, 660);
    doc.strokeColor(borderColor).lineWidth(0.75).moveTo(40, footerY).lineTo(572, footerY).stroke();

    doc.fillColor(mutedText).fontSize(7.5).font('Helvetica');
    let termsY = footerY + 8;
    if (invoice.notes && invoice.notes.trim()) {
      doc.text(`Invoice Notes: ${invoice.notes.trim()}`, 40, footerY + 6, { width: 532 });
      termsY = footerY + 20;
    }
    doc.text('Terms & Conditions: Subscriptions are billed in advance per registered billing cycle. Unsettled invoices beyond grace period trigger automated service suspension.', 40, termsY, { width: 532 })
       .text('Authorized Signatory: This is a system-generated electronic tax invoice and requires no physical signature under IT Act 2000.', 40, termsY + 12, { width: 532 });

    // Watermark if PAID
    if (statusText === 'PAID') {
      doc.save();
      doc.rotate(-30, { origin: [306, 400] });
      doc.fontSize(60).font('Helvetica-Bold').fillColor('rgba(22, 163, 74, 0.12)')
         .text('PAID & SETTLED', 110, 370);
      doc.restore();
    }
  }

  /**
   * Stream PDF directly to HTTP response
   */
  generateInvoicePdfStream(invoiceId, res, isDownload = false) {
    const details = this.getInvoiceDetails(invoiceId);
    if (!details) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `Invoice-${details.invoice.invoice_number}`,
        Author: 'Central ERP Command Platform',
        Subject: `Subscription Invoice ${details.invoice.invoice_number}`
      }
    });

    doc.on('error', (err) => {
      console.error('[PDF Stream Error]:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to generate PDF document' });
      }
    });

    const disposition = isDownload ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="Invoice-${details.invoice.invoice_number}.pdf"`);

    doc.pipe(res);
    this.buildPdfDocument(doc, details);
    doc.end();
  }

  /**
   * Generate PDF as binary buffer for email attachments
   */
  generateInvoicePdfBuffer(invoiceId) {
    return new Promise((resolve, reject) => {
      const details = this.getInvoiceDetails(invoiceId);
      if (!details) {
        return reject(new Error('Invoice not found'));
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Invoice-${details.invoice.invoice_number}`,
          Author: 'Central ERP Command Platform',
          Subject: `Subscription Invoice ${details.invoice.invoice_number}`
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), details }));
      doc.on('error', err => reject(err));

      this.buildPdfDocument(doc, details);
      doc.end();
    });
  }
}

module.exports = new PdfInvoiceService();
