// ╔══════════════════════════════════════════════════════╗
// ║  Invoice & Payout HTML Pages                          ║
// ║  GET /invoice/:id  — guest booking receipt (Proforma/ ║
// ║                       Tax Invoice — same design admin ║
// ║                       sees via the "Proforma" button) ║
// ║  GET /payout/:id   — owner payout summary             ║
// ╚══════════════════════════════════════════════════════╝
const router   = require('express').Router();
const { Booking, Property, Payment } = require('../db/models');

const INR = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s || '—'; } };
const bookingCode = b => `SD-${String(b.booking_no || 0).padStart(4, '0')}`;

// ── Guest Invoice (public — no auth, link goes out over WhatsApp/SMS) ──
// Same Proforma/Tax Invoice design as /api/bookings/:id/invoice (admin,
// authenticated); this is the guest-facing twin of that route.
router.get('/invoice/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).send('<h2>Invoice not found</h2>');
    const property = await Property.findById(booking.property_id).lean();
    const prop = property || {};

    const nights_  = booking.nights || 1;
    const totalAmt = Number(booking.total_amount || booking.amount || 0);
    // Slab: try 5% first; if back-calculated per-night base > ₹7500 → 18%
    let gstRate = 0.05;
    if ((totalAmt / nights_) / 1.05 > 7500) gstRate = 0.18;
    const gstPct    = Math.round(gstRate * 100);
    const preGstAmt = Math.round(totalAmt / (1 + gstRate));
    const halfGst   = Math.round(((totalAmt - preGstAmt) / 2) * 100) / 100;
    const gstAmt    = halfGst * 2;

    const payment = await Payment.findOne({
      booking_id: booking._id,
      status:     'captured',
    }).sort({ created_at: -1 }).lean();

    const advanceAmt = Number(booking.amount || 0);
    const balanceAmt = Number(booking.balance_amount || 0) || Math.max(0, totalAmt - advanceAmt);
    const fullyPaid  = booking.balance_paid || booking.status === 'checked_out';
    const amtPaid    = fullyPaid ? totalAmt : (payment ? Math.round(payment.amount / 100) : advanceAmt);
    const balDue     = fullyPaid ? 0 : balanceAmt;

    const isProforma = !fullyPaid;
    const docType    = isProforma ? 'PROFORMA INVOICE' : 'TAX INVOICE';
    const docColor   = isProforma ? '#d97706' : '#8B1717';

    let bookingNo = booking.booking_no;
    if (!bookingNo) {
      bookingNo = await Booking.countDocuments({ created_at: { $lte: booking.created_at || new Date() } });
      Booking.findByIdAndUpdate(booking._id, { booking_no: bookingNo }).catch(() => {});
    }
    const code = `SD-${String(bookingNo).padStart(4, '0')}`;

    const invDateSrc  = isProforma ? booking.created_at : (booking.balance_paid_at || booking.created_at);
    const invYear     = new Date(invDateSrc || Date.now()).getFullYear();
    const invoiceNo   = `${isProforma ? 'PRO' : 'INV'}-${invYear}-${String(bookingNo).padStart(4, '0')}`;
    const invoiceDate = (() => { try { return new Date(invDateSrc).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return '—'; } })();
    const statusColor = fullyPaid && !isProforma ? '#16a34a'
      : { confirmed: '#16a34a', pending: '#d97706', cancelled: '#dc2626', checked_in: '#2563eb', checked_out: '#6b7280' }[booking.status] || '#6b7280';
    const statusLabel = fullyPaid && !isProforma ? 'Fully Paid ✓'
      : (booking.status || 'pending').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    const phone = process.env.BUSINESS_PHONE || '+91 87699 05983';
    const email = process.env.BUSINESS_EMAIL || 'info@staydekho.com';
    const gstin = process.env.BUSINESS_GSTIN || 'GSTIN: 08XXXXX0000X1ZX';
    const inr   = n => '₹' + INR(n);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${docType} ${invoiceNo} — StayDekho</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12.5px;color:#1a1a1a;background:#f4f4f4}
  .page{max-width:760px;margin:16px auto;background:#fff;padding:32px 36px;box-shadow:0 2px 20px rgba(0,0,0,.1)}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid ${docColor}}
  .logo{font-size:21px;font-weight:800;color:#8B1717;letter-spacing:-.5px}
  .logo span{color:#1a1a1a}
  .company-info{font-size:10.5px;color:#555;margin-top:4px;line-height:1.6}
  .inv-meta{text-align:right}
  .inv-title{font-size:19px;font-weight:800;color:${docColor};letter-spacing:.05em;text-transform:uppercase}
  .inv-no{font-size:13px;font-weight:700;color:#1a1a1a;margin-top:3px}
  .inv-date{font-size:11px;color:#777;margin-top:2px}
  .proforma-notice{background:#fff8e1;border:1px solid #f59e0b;border-radius:8px;padding:9px 14px;margin-bottom:14px;font-size:11.5px;color:#92400e;line-height:1.5}
  .proforma-notice strong{display:block;font-size:12.5px;margin-bottom:2px}
  .badge{display:inline-block;padding:3px 11px;border-radius:20px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;margin-top:6px;background:${statusColor}}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .info-box{background:#fafafa;border:1px solid #e8e8e8;border-radius:8px;padding:12px 14px}
  .info-box h4{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8B1717;margin-bottom:7px}
  .info-row{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;gap:8px}
  .info-row .lbl{color:#777;flex-shrink:0}
  .info-row .val{font-weight:600;text-align:right}
  .info-row.highlight .val{color:#8B1717;font-size:12.5px}
  table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px}
  thead tr{background:#8B1717;color:#fff}
  thead th{padding:8px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  thead th:last-child{text-align:right}
  tbody tr{border-bottom:1px solid #f0f0f0}
  tbody td{padding:9px 12px;vertical-align:top}
  tbody td:last-child{text-align:right;font-weight:600}
  .desc-sub{font-size:10.5px;color:#888;margin-top:2px}
  .totals{margin-left:auto;width:280px}
  .tot-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:1px solid #f0f0f0}
  .tot-row .lbl{color:#555}
  .tot-row.subtotal{font-weight:600}
  .tot-row.gst-row{color:#777;font-size:11px}
  .tot-row.grand{background:#8B1717;color:#fff;font-weight:800;font-size:14px;padding:9px 12px;border-radius:6px;margin-top:5px;border:none}
  .pay-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0;padding:14px;background:#f9f5f5;border-radius:8px;border:1px solid #f0e0e0}
  .pay-box{text-align:center}
  .pay-box .amt{font-size:17px;font-weight:800;color:#8B1717}
  .pay-box .lbl{font-size:9.5px;color:#888;text-transform:uppercase;letter-spacing:.07em;margin-top:3px}
  .pay-box.paid .amt{color:#16a34a}
  .pay-box.due  .amt{color:${balDue > 0 ? '#dc2626' : '#16a34a'}}
  .notes{background:#fafafa;border:1px solid #e8e8e8;border-radius:8px;padding:12px 14px;margin-top:14px;font-size:10px;color:#555;line-height:1.55}
  .notes h4{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#333;margin-bottom:6px}
  .terms-grid{columns:2;column-gap:22px}
  .terms-grid p{margin-bottom:4px;break-inside:avoid}
  .terms-grid b{color:#333}
  .footer{margin-top:16px;padding-top:12px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#aaa}
  .print-btn{position:fixed;bottom:24px;right:24px;background:#8B1717;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(139,23,23,.4);z-index:99}
  .print-btn:hover{background:#6b1010}
  @media print{
    @page{size:A4;margin:12mm}
    body{background:#fff}
    .page{box-shadow:none;margin:0;padding:0;max-width:100%}
    .print-btn{display:none}
    .badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    thead tr,.tot-row.grand,.pay-summary{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">🖨️ Print / Save PDF</button>

<div class="page">

  <div class="hdr">
    <div>
      <div class="logo">StayDekh<span>o</span></div>
      <div class="company-info">
        Premium Group Stays · Udaipur, Rajasthan<br/>
        ${phone} · ${email}<br/>
        ${gstin}
      </div>
    </div>
    <div class="inv-meta">
      <div class="inv-title">${docType}</div>
      <div class="inv-no">${invoiceNo}</div>
      <div class="inv-date">Date: ${invoiceDate}</div>
      <div><span class="badge">${statusLabel}</span></div>
    </div>
  </div>

  ${isProforma ? `
  <div class="proforma-notice">
    <strong>⚠️ This is a Proforma Invoice (Advance Receipt)</strong>
    This document confirms your advance payment of ${inr(amtPaid)} (${totalAmt ? Math.round(amtPaid / totalAmt * 100) : 0}% of total).
    A Final Tax Invoice will be issued after full payment at check-in.
    Balance due at check-in: <strong>${inr(balDue)}</strong>
  </div>
  ` : ''}

  <div class="info-grid">
    <div class="info-box">
      <h4>Bill To</h4>
      <div class="info-row"><span class="lbl">Name</span><span class="val">${booking.guest_name || '—'}</span></div>
      <div class="info-row"><span class="lbl">Email</span><span class="val" style="font-size:11px">${booking.guest_email || '—'}</span></div>
      <div class="info-row"><span class="lbl">Phone</span><span class="val">${booking.guest_phone || '—'}</span></div>
    </div>
    <div class="info-box">
      <h4>Booking Details</h4>
      <div class="info-row"><span class="lbl">Booking ID</span><span class="val">${code}</span></div>
      <div class="info-row"><span class="lbl">Check-in</span><span class="val">${fmtD(booking.checkin)}</span></div>
      <div class="info-row"><span class="lbl">Check-out</span><span class="val">${fmtD(booking.checkout)}</span></div>
      <div class="info-row"><span class="lbl">Duration</span><span class="val">${nights_} Night${nights_ > 1 ? 's' : ''}</span></div>
      <div class="info-row highlight"><span class="lbl">Guests</span><span class="val">${booking.guests || 1} Guest${(booking.guests || 1) > 1 ? 's' : ''}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr style="background:${docColor}">
        <th style="width:50%">Description</th>
        <th>Rate</th>
        <th>Nights</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <strong>${prop.name || 'Accommodation'}</strong>
          <div class="desc-sub">${prop.location || ''} · ${prop.beds || '—'} Beds · Up to ${prop.guests || '—'} Guests</div>
        </td>
        <td>${inr(Math.round(totalAmt / nights_))}/night</td>
        <td>${nights_}</td>
        <td>${inr(isProforma ? totalAmt : (totalAmt - gstAmt))}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    ${isProforma ? `
    <div class="tot-row grand" style="background:${docColor}">
      <span>Total Amount</span>
      <span>${inr(totalAmt)}</span>
    </div>
    ` : `
    <div class="tot-row subtotal">
      <span class="lbl">Accommodation (${nights_} night${nights_ > 1 ? 's' : ''})</span>
      <span>${inr(totalAmt - gstAmt)}</span>
    </div>
    <div class="tot-row gst-row">
      <span class="lbl">CGST @ ${gstPct / 2}%</span>
      <span>${inr(halfGst)}</span>
    </div>
    <div class="tot-row gst-row">
      <span class="lbl">SGST @ ${gstPct / 2}%</span>
      <span>${inr(halfGst)}</span>
    </div>
    <div class="tot-row subtotal">
      <span class="lbl">Total GST (${gstPct}%)</span>
      <span>${inr(gstAmt)}</span>
    </div>
    <div class="tot-row grand" style="background:${docColor}">
      <span>Grand Total</span>
      <span>${inr(totalAmt)}</span>
    </div>
    `}
  </div>

  <div class="pay-summary">
    <div class="pay-box">
      <div class="amt">${inr(totalAmt)}</div>
      <div class="lbl">Total Amount</div>
    </div>
    <div class="pay-box paid">
      <div class="amt">${inr(amtPaid)}</div>
      <div class="lbl">${isProforma ? 'Advance Paid' : 'Amount Paid'}</div>
    </div>
    <div class="pay-box due">
      <div class="amt">${inr(balDue)}</div>
      <div class="lbl">${balDue > 0 ? (isProforma ? 'Due at Check-in' : 'Balance Due') : 'Fully Paid ✓'}</div>
    </div>
  </div>

  ${booking.notes ? `
  <div class="notes" style="margin-top:12px;background:#fffbeb;border-color:#fde68a">
    <h4 style="color:#92400e">Booking Notes</h4>
    ${String(booking.notes).replace(/\n/g, '<br/>')}
  </div>` : ''}

  <div class="notes">
    <h4>Terms &amp; Conditions</h4>
    <div class="terms-grid">
      <p><b>1. Timing:</b> Check-in 12:00 PM (Noon) · Check-out 10:00 AM. Early check-in / late check-out subject to availability &amp; may incur extra charges.</p>
      <p><b>2. ID Proof:</b> All guests must carry a valid government photo ID (Aadhaar / Passport / DL / Voter ID) at check-in. Primary guest must be 18+.</p>
      <p><b>3. Occupancy:</b> As per booked property limit. Extra guests need prior approval &amp; may incur additional charges.</p>
      <p><b>4. Advance Non-Refundable:</b> The advance amount is strictly non-refundable under all circumstances, including cancellation or no-show.</p>
      <p><b>5. Cancellation:</b> Balance payments, if any, are refunded as per StayDekho's cancellation policy within 5–7 business days.</p>
      <p><b>6. Property Care:</b> Guests are liable for any loss or damage to the property or its assets. StayDekho is not responsible for guests' personal belongings.</p>
      <p><b>7. House Rules:</b> No smoking indoors. No loud music / parties after 10:00 PM unless pre-approved. Please respect the property &amp; neighbours.</p>
      <p><b>8. Tax:</b> GST charged as per prevailing Indian hotel accommodation rates. SAC: 996311.</p>
      <p><b>9. Jurisdiction:</b> All disputes subject to Udaipur, Rajasthan jurisdiction.</p>
      <p>${isProforma
        ? `<b>10. Note:</b> This Proforma Invoice confirms the advance only. A Final Tax Invoice will be issued after full payment at check-in.`
        : `<b>10. Note:</b> This is a computer-generated Final Tax Invoice &amp; requires no physical signature. Payment received in full — thank you for choosing StayDekho.`}</p>
    </div>
  </div>

  ${prop.caretaker_name || prop.caretaker_phone ? `
  <div class="notes" style="margin-top:12px">
    <h4>Property Contact</h4>
    ${prop.caretaker_name || ''}${prop.caretaker_phone ? ` · ${prop.caretaker_phone}` : ''}
  </div>` : ''}

  <div class="footer">
    <span>StayDekho · Udaipur, Rajasthan · ${phone}</span>
    <span>${invoiceNo} · Generated ${new Date().toLocaleDateString('en-IN')}</span>
  </div>

</div>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

// ── Owner Payout Statement (public — no auth, link goes out over WhatsApp) ──
// Same design as /api/bookings/:id/owner-bill (admin, authenticated), minus
// the exact commission split — a forwarded link shouldn't hand StayDekho's
// commission structure to anyone who happens to see it.
const PLATFORM_LABELS = { direct: 'Direct (Website)', airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', mmt_goibibo: 'MMT / Goibibo', walkin: 'Walk-in' };

router.get('/payout/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).send('<h2>Payout record not found</h2>');
    const property = await Property.findById(booking.property_id).lean();
    const prop = property || {};

    const nights   = booking.nights || 1;
    const totalAmt = Number(booking.total_amount || booking.amount || 0);
    const platform = booking.platform || 'direct';
    const isDirect = platform === 'direct' || platform === 'walkin';

    let base, baseLabel;
    if (isDirect) {
      base = totalAmt;
      baseLabel = 'Guest Paid (Total)';
    } else {
      base = booking.net_payout != null ? booking.net_payout : totalAmt;
      baseLabel = `${PLATFORM_LABELS[platform] || platform} Net Payout (after platform deductions)`;
    }
    // Net Payout is the RAW amount the platform transfers (before tax) — the
    // admin enters it that way deliberately. Occupancy tax the platform
    // remits to govt on our behalf still needs to come out before the split.
    const remittedTax = isDirect ? 0 : (Number(booking.remitted_tax) || 0);
    const netRevenue  = Math.max(0, base - remittedTax);
    const ownerShare  = Math.round(netRevenue * 0.70);

    let bookingNo = booking.booking_no;
    if (!bookingNo) {
      bookingNo = await Booking.countDocuments({ created_at: { $lte: booking.created_at || new Date() } });
      Booking.findByIdAndUpdate(booking._id, { booking_no: bookingNo }).catch(() => {});
    }
    const code   = `SD-${String(bookingNo).padStart(4, '0')}`;
    const stmtNo = `OWN-${new Date(booking.created_at || Date.now()).getFullYear()}-${String(bookingNo).padStart(4, '0')}`;
    const fullyPaid = booking.balance_paid || booking.status === 'checked_out';
    const phone = process.env.BUSINESS_PHONE || '+91 87699 05983';
    const email = process.env.BUSINESS_EMAIL || 'info@staydekho.com';
    const inr   = n => '₹' + INR(n);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Owner Statement ${stmtNo} — StayDekho</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#f4f4f4}
  .page{max-width:700px;margin:24px auto;background:#fff;padding:40px;box-shadow:0 2px 20px rgba(0,0,0,.1)}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #1d4ed8}
  .logo{font-size:22px;font-weight:800;color:#8B1717}.logo span{color:#1a1a1a}
  .company-info{font-size:11px;color:#555;margin-top:4px;line-height:1.7}
  .inv-title{font-size:18px;font-weight:800;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em}
  .inv-no{font-size:13px;font-weight:700;margin-top:4px}.inv-date{font-size:11px;color:#777;margin-top:2px}
  .info-box{background:#fafafa;border:1px solid #e8e8e8;border-radius:8px;padding:16px;margin-bottom:20px}
  .info-box h4{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#1d4ed8;margin-bottom:10px}
  .info-row{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;gap:8px}
  .info-row .lbl{color:#777}.info-row .val{font-weight:600;text-align:right}
  .split{margin-top:20px}
  .split-row{display:flex;justify-content:space-between;padding:10px 14px;font-size:13px;border-bottom:1px solid #f0f0f0}
  .split-row .lbl{color:#555}
  .split-row.base{background:#f8fafc;font-weight:700;border-radius:8px 8px 0 0}
  .split-row.owner{background:#f0fdf4;font-weight:800;font-size:15px;color:#15803d;border-radius:0 0 8px 8px}
  .paid-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:${fullyPaid ? '#16a34a' : '#d97706'};margin-top:8px}
  .footer{margin-top:28px;padding-top:16px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;font-size:11px;color:#aaa}
  .print-btn{position:fixed;bottom:24px;right:24px;background:#1d4ed8;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;z-index:99}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:28px}.print-btn{display:none}
    .split-row,.paid-badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨️ Print / Save PDF</button>
<div class="page">
  <div class="hdr">
    <div>
      <div class="logo">StayDekh<span>o</span></div>
      <div class="company-info">Premium Group Stays · Udaipur, Rajasthan<br/>${phone} · ${email}</div>
    </div>
    <div style="text-align:right">
      <div class="inv-title">Owner Payout Statement</div>
      <div class="inv-no">${stmtNo}</div>
      <div class="inv-date">Booking: ${code}</div>
      <div><span class="paid-badge">${fullyPaid ? 'Guest Fully Paid ✓' : 'Payment Pending'}</span></div>
    </div>
  </div>

  <div class="info-box">
    <h4>Booking Details</h4>
    <div class="info-row"><span class="lbl">Property</span><span class="val">${prop.name || '—'}</span></div>
    <div class="info-row"><span class="lbl">Guest Name</span><span class="val">${booking.guest_name || '—'}</span></div>
    <div class="info-row"><span class="lbl">Check-in</span><span class="val">${fmtD(booking.checkin)}</span></div>
    <div class="info-row"><span class="lbl">Check-out</span><span class="val">${fmtD(booking.checkout)}</span></div>
    <div class="info-row"><span class="lbl">Nights</span><span class="val">${nights}</span></div>
    <div class="info-row"><span class="lbl">Booking Source</span><span class="val">${PLATFORM_LABELS[platform] || platform}</span></div>
    ${isDirect
      ? `<div class="info-row"><span class="lbl">Guest Paid (Total)</span><span class="val">${inr(totalAmt)}</span></div>
         <div class="info-row"><span class="lbl">Advance (Online)</span><span class="val">${inr(booking.amount || 0)}</span></div>
         <div class="info-row"><span class="lbl">Balance (At Check-in)</span><span class="val">${inr(booking.balance_amount || 0)} ${booking.balance_paid ? '✓ Received' : '(Pending)'}</span></div>`
      : `<div class="info-row"><span class="lbl">Platform Net Payout</span><span class="val">${inr(base)}</span></div>`}
  </div>

  <div class="split">
    <div class="split-row base"><span class="lbl">${baseLabel}</span><span>${inr(base)}</span></div>
    ${remittedTax > 0 ? `
    <div class="split-row" style="color:#777;font-size:12px"><span class="lbl">Less: Remitted Occupancy Tax (collected &amp; remitted to govt by ${PLATFORM_LABELS[platform] || platform})</span><span>− ${inr(remittedTax)}</span></div>
    ` : ''}
    <div class="split-row owner"><span class="lbl">🏠 Your Payout</span><span>${inr(ownerShare)}</span></div>
  </div>

  <div class="footer">
    <span>StayDekho · Udaipur, Rajasthan · ${phone}</span>
    <span>${stmtNo} · Generated ${new Date().toLocaleDateString('en-IN')}</span>
  </div>
</div>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

module.exports = router;
