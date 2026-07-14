const router   = require('express').Router();
const Razorpay  = require('razorpay');
const { Booking, Property, Payment, DatePrice } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');
const { sendEmail, bookingCancelledHtml } = require('../services/email');
const { blockCalendarForBooking, unblockCalendarIfFree, createCleaningTaskForCheckout, notifyGuestBookingCancelled } = require('../services/bookingAutomation');

function getRazorpay() {
  const key_id     = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new Error('Razorpay keys not configured');
  return new Razorpay({ key_id, key_secret });
}

// Refund the captured payment for a booking (if any). Returns refund object or null.
async function initiateRefund(bookingId) {
  const payment = await Payment.findOne({ booking_id: bookingId, status: 'captured' }).lean();
  if (!payment || !payment.razorpay_payment_id) return null;
  try {
    const rzp    = getRazorpay();
    const refund = await rzp.payments.refund(payment.razorpay_payment_id, {
      amount: payment.amount, // paise
      speed:  'normal',
      notes:  { reason: 'Booking cancelled', booking_id: String(bookingId) },
    });
    await Payment.findByIdAndUpdate(payment._id, {
      status:            'refunded',
      razorpay_refund_id: refund.id,
    });
    return refund;
  } catch (e) {
    console.error('Refund error for booking', bookingId, e?.error?.description || e.message);
    return null;
  }
}

// GET /api/bookings  — admin gets all, user gets own
router.get('/', protect, async (req, res) => {
  try {
    let bookings;
    if (req.user.role === 'admin') {
      bookings = await Booking.find()
        .populate('user_id', 'name email')
        .populate('property_id', 'name location')
        .sort({ created_at: -1 })
        .lean();
      bookings = bookings.map(b => ({
        ...b,
        user_name:         b.user_id?.name,
        user_email:        b.user_id?.email,
        property_name:     b.property_id?.name,
        property_location: b.property_id?.location,
      }));
    } else {
      bookings = await Booking.find({ user_id: req.user.id })
        .populate('property_id', 'name location images')
        .sort({ created_at: -1 })
        .lean();
      bookings = bookings.map(b => ({
        ...b,
        property_name:     b.property_id?.name,
        property_location: b.property_id?.location,
        property_images:   b.property_id?.images,
      }));
    }
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const row = await Booking.findById(req.params.id)
      .populate('property_id', 'name location price images beds guests')
      .lean();

    if (!row) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role !== 'admin' && row.user_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });

    const prop = row.property_id || {};
    res.json({
      booking: {
        ...row,
        property_name:     prop.name,
        property_location: prop.location,
        property_price:    prop.price,
        property_images:   JSON.parse(prop.images || '[]'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings  — create booking (returns order to pay)
router.post('/', protect, async (req, res) => {
  const { property_id, checkin, checkout, guests, guest_name, guest_email, guest_phone } = req.body;
  if (!property_id || !checkin || !checkout)
    return res.status(400).json({ error: 'Property, check-in and check-out are required' });

  try {
    const property = await Property.findOne({ _id: property_id, status: 'Active' }).lean();
    if (!property) return res.status(404).json({ error: 'Property not found or inactive' });

    // T12:00:00 avoids timezone midnight boundary off-by-one
    const cin  = new Date((checkin + '').slice(0,10) + 'T12:00:00');
    const cout = new Date((checkout + '').slice(0,10) + 'T12:00:00');
    if (cout <= cin) return res.status(400).json({ error: 'Check-out must be after check-in' });

    // Double-booking check
    const overlap = await Booking.findOne({
      property_id,
      status:   { $nin: ['cancelled', 'checked_out'] },
      checkin:  { $lt: checkout },
      checkout: { $gt: checkin },
    }).lean();
    if (overlap) return res.status(409).json({ error: 'These dates are already booked. Please choose different dates.' });

    const nights = Math.max(1, Math.round((cout - cin) / (1000 * 60 * 60 * 24)));

    // Build per-night prices from DatePrice, fallback to property.price
    let base = 0;
    for (let i = 0; i < nights; i++) {
      const d = new Date(cin);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dp = await DatePrice.findOne({
        property_id,
        date:    dateStr,
        blocked: false,
        price:   { $ne: null },
      }).lean();
      base += dp ? dp.price : property.price;
    }

    const avgNight = base / nights;
    const gstRate  = avgNight > 7500 ? 0.18 : 0.05;
    const gst      = Math.round(base * gstRate);
    const svc      = Math.round(base * 0.05);
    const total    = base + gst + svc;

    // 30% advance at booking, 70% at check-in
    const advance  = Math.round(total * 0.30);
    const balance  = total - advance;

    const bookingNo = (await Booking.countDocuments()) + 1;
    const booking = await Booking.create({
      user_id:      req.user.id,
      booking_no:   bookingNo,
      property_id,
      guest_name:   guest_name  || req.user.name,
      guest_email:  guest_email || req.user.email,
      guest_phone:  guest_phone || req.user.phone || '',
      checkin,
      checkout,
      guests:       guests || 1,
      nights,
      amount:       advance,        // only 30% charged online
      total_amount: total,          // full price
      balance_amount: balance,      // 70% due at check-in
      payment_type: 'partial',
      balance_paid: false,
      status:       'pending',
    });

    res.status(201).json({
      booking: booking.toObject(),
      amount:         advance,
      total_amount:   total,
      balance_amount: balance,
      nights,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/balance-paid  — admin marks balance collected at check-in
router.put('/:id/balance-paid', protect, adminOnly, async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { balance_paid: true, balance_paid_at: new Date() },
      { new: true }
    ).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: 'Balance marked as collected', booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/status  — admin update status
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out'];
  if (!allowed.includes(status))
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });

  try {
    const prev = await Booking.findById(req.params.id).lean();
    await Booking.findByIdAndUpdate(req.params.id, { status });

    // Auto-refund when admin cancels a previously confirmed booking
    let refund = null;
    if (status === 'cancelled' && prev && prev.status === 'confirmed') {
      refund = await initiateRefund(req.params.id);
    }

    // ── Automation chain ──
    if (prev) {
      if (status === 'cancelled') {
        unblockCalendarIfFree(prev.property_id, prev.checkin, prev.checkout, prev._id).catch(e => console.error(e.message));
        const prop = await Property.findById(prev.property_id).lean().catch(() => null);
        notifyGuestBookingCancelled(prev, prop?.name || '').catch(e => console.error(e.message));
      } else if (status === 'confirmed') {
        blockCalendarForBooking(prev.property_id, prev.checkin, prev.checkout).catch(e => console.error(e.message));
        createCleaningTaskForCheckout(prev.property_id, prev.checkout).catch(e => console.error(e.message));
      }
    }

    res.json({ message: 'Status updated', status, refund_initiated: !!refund });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:id/invoice
// ?type=proforma → Proforma Invoice (advance payment)
// ?type=final    → Final Tax Invoice (full payment)
// Auto-detects if ?type not provided: balance_paid=false → Proforma, else Final
// Supports ?token=JWT for direct browser tab opening
router.get('/:id/invoice', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('user_id', 'name email phone')
      .populate('property_id', 'name location price beds guests')
      .lean();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role !== 'admin' && booking.user_id?._id?.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });

    const row = {
      ...booking,
      id:            booking._id.toString(),
      user_name:     booking.user_id?.name,
      user_email:    booking.user_id?.email,
      user_phone:    booking.user_id?.phone,
      prop_name:     booking.property_id?.name,
      prop_location: booking.property_id?.location,
      prop_price:    booking.property_id?.price,
      prop_beds:     booking.property_id?.beds,
      prop_guests:   booking.property_id?.guests,
    };

    // ── GST calculation — no service fee, pure accommodation + GST
    const nights_    = row.nights || 1;
    const totalAmt   = row.total_amount || row.amount || 0;
    // Slab: try 5% first; if back-calculated per-night base > ₹7500 → 18%
    let gstRate = 0.05;
    if ((totalAmt / nights_) / 1.05 > 7500) gstRate = 0.18;
    const gstPct    = Math.round(gstRate * 100);
    const preGstAmt = Math.round(totalAmt / (1 + gstRate));
    const gstAmt    = totalAmt - preGstAmt;
    const halfGst   = Math.round(gstAmt / 2);

    // ── Payment info ──────────────────────────────────────
    const payment = await Payment.findOne({
      booking_id: booking._id,
      status:     'captured',
    }).sort({ created_at: -1 }).lean();

    const advanceAmt  = row.amount || 0;
    const balanceAmt  = row.balance_amount || Math.max(0, totalAmt - advanceAmt);
    const fullyPaid   = row.balance_paid || row.status === 'checked_out';
    const amtPaid     = fullyPaid ? totalAmt : (payment ? Math.round(payment.amount / 100) : advanceAmt);
    const balDue      = fullyPaid ? 0 : balanceAmt;

    // ── Proforma vs Final Tax Invoice ─────────────────────
    const forceType  = req.query.type;
    const isProforma  = forceType === 'proforma' || (!forceType && !fullyPaid);
    const docType     = isProforma ? 'PROFORMA INVOICE' : 'TAX INVOICE';
    const docColor    = isProforma ? '#d97706' : '#8B1717';

    // Systematic booking number (backfill for old bookings: position by created date)
    let bookingNo = row.booking_no;
    if (!bookingNo) {
      bookingNo = await Booking.countDocuments({ created_at: { $lte: row.created_at || new Date() } });
      Booking.findByIdAndUpdate(booking._id, { booking_no: bookingNo }).catch(() => {});
    }
    const bookingCode = `SD-${String(bookingNo).padStart(4, '0')}`;

    // Proforma date = booking date; Final invoice date = full-payment date
    const invDateSrc  = isProforma ? row.created_at : (row.balance_paid_at || row.created_at);
    const invYear     = new Date(invDateSrc || Date.now()).getFullYear();
    const invoiceNo   = `${isProforma ? 'PRO' : 'INV'}-${invYear}-${String(bookingNo).padStart(4, '0')}`;
    const invoiceDate = (() => { try { return new Date(invDateSrc).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return '—'; } })();
    const fmtD        = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s || '—'; } };
    const statusColor = fullyPaid && !isProforma ? '#16a34a'
      : { confirmed: '#16a34a', pending: '#d97706', cancelled: '#dc2626', checked_in: '#2563eb', checked_out: '#6b7280' }[row.status] || '#6b7280';
    const statusLabel = fullyPaid && !isProforma ? 'Fully Paid ✓'
      : (row.status || 'pending').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    const phone = process.env.BUSINESS_PHONE || '+91 87699 05983';
    const email = process.env.BUSINESS_EMAIL || 'info@staydekho.com';
    const gstin = process.env.BUSINESS_GSTIN || 'GSTIN: 08XXXXX0000X1ZX';
    const INR   = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${docType} ${invoiceNo} — StayDekho</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#f4f4f4}
  .page{max-width:760px;margin:24px auto;background:#fff;padding:40px;box-shadow:0 2px 20px rgba(0,0,0,.1)}
  /* Header */
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid ${docColor}}
  .logo{font-size:22px;font-weight:800;color:#8B1717;letter-spacing:-.5px}
  .logo span{color:#1a1a1a}
  .company-info{font-size:11px;color:#555;margin-top:4px;line-height:1.7}
  .inv-meta{text-align:right}
  .inv-title{font-size:20px;font-weight:800;color:${docColor};letter-spacing:.05em;text-transform:uppercase}
  .inv-no{font-size:13px;font-weight:700;color:#1a1a1a;margin-top:4px}
  .inv-date{font-size:11px;color:#777;margin-top:2px}
  /* Proforma notice banner */
  .proforma-notice{background:#fff8e1;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#92400e;line-height:1.6}
  .proforma-notice strong{display:block;font-size:13px;margin-bottom:3px}
  /* Status badge */
  .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;margin-top:8px;background:${statusColor}}
  /* Info grid */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px}
  .info-box{background:#fafafa;border:1px solid #e8e8e8;border-radius:8px;padding:16px}
  .info-box h4{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8B1717;margin-bottom:10px}
  .info-row{display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;gap:8px}
  .info-row .lbl{color:#777;flex-shrink:0}
  .info-row .val{font-weight:600;text-align:right}
  .info-row.highlight .val{color:#8B1717;font-size:13px}
  /* Table */
  table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12.5px}
  thead tr{background:#8B1717;color:#fff}
  thead th{padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  thead th:last-child{text-align:right}
  tbody tr{border-bottom:1px solid #f0f0f0}
  tbody tr:hover{background:#fafafa}
  tbody td{padding:11px 12px;vertical-align:top}
  tbody td:last-child{text-align:right;font-weight:600}
  .desc-sub{font-size:11px;color:#888;margin-top:2px}
  /* Totals */
  .totals{margin-left:auto;width:280px}
  .tot-row{display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px;border-bottom:1px solid #f0f0f0}
  .tot-row .lbl{color:#555}
  .tot-row.subtotal{font-weight:600}
  .tot-row.gst-row{color:#777;font-size:11.5px}
  .tot-row.grand{background:#8B1717;color:#fff;font-weight:800;font-size:14px;padding:10px 12px;border-radius:6px;margin-top:6px;border:none}
  /* Payment summary */
  .pay-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0;padding:16px;background:#f9f5f5;border-radius:8px;border:1px solid #f0e0e0}
  .pay-box{text-align:center}
  .pay-box .amt{font-size:18px;font-weight:800;color:#8B1717}
  .pay-box .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.07em;margin-top:3px}
  .pay-box.paid .amt{color:#16a34a}
  .pay-box.due  .amt{color:${balDue > 0 ? '#dc2626' : '#16a34a'}}
  /* Notes */
  .notes{background:#fafafa;border:1px solid #e8e8e8;border-radius:8px;padding:16px;margin-top:20px;font-size:11px;color:#666;line-height:1.8}
  .notes h4{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#333;margin-bottom:8px}
  /* Footer */
  .footer{margin-top:28px;padding-top:16px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#aaa}
  /* Print */
  .print-btn{position:fixed;bottom:24px;right:24px;background:#8B1717;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(139,23,23,.4);z-index:99}
  .print-btn:hover{background:#6b1010}
  @media print{
    body{background:#fff}
    .page{box-shadow:none;margin:0;padding:28px}
    .print-btn{display:none}
    .badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    thead tr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">🖨️ Print / Save PDF</button>

<div class="page">

  <!-- ── HEADER ── -->
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
  <!-- ── PROFORMA NOTICE ── -->
  <div class="proforma-notice">
    <strong>⚠️ This is a Proforma Invoice (Advance Receipt)</strong>
    This document confirms your advance payment of ${INR(amtPaid)} (${Math.round(amtPaid/totalAmt*100)}% of total).
    A Final Tax Invoice will be issued after full payment at check-in.
    Balance due at check-in: <strong>${INR(balDue)}</strong>
  </div>
  ` : ''}

  <!-- ── BILL TO + BOOKING DETAILS ── -->
  <div class="info-grid">
    <div class="info-box">
      <h4>Bill To</h4>
      <div class="info-row"><span class="lbl">Name</span><span class="val">${row.guest_name || row.user_name || '—'}</span></div>
      <div class="info-row"><span class="lbl">Email</span><span class="val" style="font-size:11px">${row.guest_email || row.user_email || '—'}</span></div>
      <div class="info-row"><span class="lbl">Phone</span><span class="val">${row.guest_phone || row.user_phone || '—'}</span></div>
    </div>
    <div class="info-box">
      <h4>Booking Details</h4>
      <div class="info-row"><span class="lbl">Booking ID</span><span class="val">${bookingCode}</span></div>
      <div class="info-row"><span class="lbl">Check-in</span><span class="val">${fmtD(row.checkin)}</span></div>
      <div class="info-row"><span class="lbl">Check-out</span><span class="val">${fmtD(row.checkout)}</span></div>
      <div class="info-row"><span class="lbl">Duration</span><span class="val">${row.nights} Night${row.nights > 1 ? 's' : ''}</span></div>
      <div class="info-row highlight"><span class="lbl">Guests</span><span class="val">${row.guests || 1} Guest${(row.guests || 1) > 1 ? 's' : ''}</span></div>
    </div>
  </div>

  <!-- ── CHARGES TABLE ── -->
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
          <strong>${row.prop_name || 'Accommodation'}</strong>
          <div class="desc-sub">${row.prop_location || ''} · ${row.prop_beds || '—'} Beds · Up to ${row.prop_guests || '—'} Guests</div>
        </td>
        <td>${INR(Math.round(totalAmt / nights_))}/night</td>
        <td>${row.nights}</td>
        <td>${INR(isProforma ? totalAmt : (totalAmt - gstAmt))}</td>
      </tr>
    </tbody>
  </table>

  <!-- ── TOTALS ── -->
  <div class="totals">
    ${isProforma ? `
    <div class="tot-row grand" style="background:${docColor}">
      <span>Total Amount</span>
      <span>${INR(totalAmt)}</span>
    </div>
    ` : `
    <div class="tot-row subtotal">
      <span class="lbl">Accommodation (${row.nights} night${row.nights > 1 ? 's' : ''})</span>
      <span>${INR(totalAmt - gstAmt)}</span>
    </div>
    <div class="tot-row gst-row">
      <span class="lbl">CGST @ ${gstPct / 2}%</span>
      <span>${INR(halfGst)}</span>
    </div>
    <div class="tot-row gst-row">
      <span class="lbl">SGST @ ${gstPct / 2}%</span>
      <span>${INR(gstAmt - halfGst)}</span>
    </div>
    <div class="tot-row subtotal">
      <span class="lbl">Total GST (${gstPct}%)</span>
      <span>${INR(gstAmt)}</span>
    </div>
    <div class="tot-row grand" style="background:${docColor}">
      <span>Grand Total</span>
      <span>${INR(totalAmt)}</span>
    </div>
    `}
  </div>

  <!-- ── PAYMENT SUMMARY ── -->
  <div class="pay-summary">
    <div class="pay-box">
      <div class="amt">${INR(totalAmt)}</div>
      <div class="lbl">Total Amount</div>
    </div>
    <div class="pay-box paid">
      <div class="amt">${INR(amtPaid)}</div>
      <div class="lbl">${isProforma ? 'Advance Paid' : 'Amount Paid'}</div>
    </div>
    <div class="pay-box due">
      <div class="amt">${INR(balDue)}</div>
      <div class="lbl">${balDue > 0 ? (isProforma ? 'Due at Check-in' : 'Balance Due') : 'Fully Paid ✓'}</div>
    </div>
  </div>

  ${row.notes ? `
  <!-- ── BOOKING NOTES ── -->
  <div class="notes" style="margin-top:12px;background:#fffbeb;border-color:#fde68a">
    <h4 style="color:#92400e">Booking Notes</h4>
    ${String(row.notes).replace(/\n/g, '<br/>')}
  </div>` : ''}

  <!-- ── TERMS ── -->
  <div class="notes">
    <h4>Terms & Conditions</h4>
    Check-in time: 2:00 PM onwards · Check-out time: 11:00 AM sharp<br/>
    ${isProforma
      ? `This Proforma Invoice is valid for the booking period only. Final Tax Invoice will be issued upon full payment at check-in.<br/>
    Advance payment is non-refundable as per cancellation policy.`
      : `This is a computer-generated Final Tax Invoice and does not require a physical signature.<br/>
    Payment received in full. Thank you for staying with StayDekho.`
    }<br/>
    GST calculated as per prevailing Indian hotel accommodation tax rates (SAC: 996311).
  </div>

  <!-- ── FOOTER ── -->
  <div class="footer">
    <span>StayDekho · Udaipur, Rajasthan · ${phone}</span>
    <span>${invoiceNo} · Generated ${new Date().toLocaleDateString('en-IN')}</span>
  </div>

</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:id/owner-bill — Owner Payout Statement (admin only, printable)
// Direct/walk-in: (total − GST) split 70% owner / 30% StayDekho
// OTA: platform net payout split 70/30 directly — no tax lines
router.get('/:id/owner-bill', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, protect, adminOnly, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('property_id', 'name location')
      .lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const nights   = booking.nights || 1;
    const totalAmt = booking.total_amount || booking.amount || 0;
    const platform = booking.platform || 'direct';
    const isDirect = platform === 'direct' || platform === 'walkin';
    const PLATFORM_LABELS = { direct: 'Direct (Website)', airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', mmt_goibibo: 'MMT / Goibibo', walkin: 'Walk-in' };

    // Base for the 70:30 split
    let base, baseLabel, gstDeducted = 0;
    if (isDirect) {
      let gstRate = 0.05;
      if ((totalAmt / nights) / 1.05 > 7500) gstRate = 0.18;
      base = Math.round(totalAmt / (1 + gstRate));
      gstDeducted = totalAmt - base;
      baseLabel = 'Booking Amount';
    } else {
      base = booking.net_payout != null ? booking.net_payout : totalAmt;
      baseLabel = `${PLATFORM_LABELS[platform]} Net Payout (after platform deductions)`;
    }
    const ownerShare = Math.round(base * 0.70);
    const sdShare    = base - ownerShare;

    let bookingNo = booking.booking_no;
    if (!bookingNo) {
      bookingNo = await Booking.countDocuments({ created_at: { $lte: booking.created_at || new Date() } });
      Booking.findByIdAndUpdate(booking._id, { booking_no: bookingNo }).catch(() => {});
    }
    const bookingCode = `SD-${String(bookingNo).padStart(4, '0')}`;
    const stmtNo      = `OWN-${new Date(booking.created_at || Date.now()).getFullYear()}-${String(bookingNo).padStart(4, '0')}`;

    const fullyPaid = booking.balance_paid || booking.status === 'checked_out';
    const INR  = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 });
    const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s || '—'; } };
    const phone = process.env.BUSINESS_PHONE || '+91 87699 05983';
    const email = process.env.BUSINESS_EMAIL || 'info@staydekho.com';

    const html = `<!DOCTYPE html>
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
  .split-row.owner{background:#f0fdf4;font-weight:800;font-size:15px;color:#15803d}
  .split-row.sd{background:#fef2f2;font-weight:700;color:#8B1717}
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
      <div class="inv-date">Booking: ${bookingCode}</div>
      <div><span class="paid-badge">${fullyPaid ? 'Guest Fully Paid ✓' : 'Payment Pending'}</span></div>
    </div>
  </div>

  <div class="info-box">
    <h4>Booking Details</h4>
    <div class="info-row"><span class="lbl">Property</span><span class="val">${booking.property_id?.name || '—'}</span></div>
    <div class="info-row"><span class="lbl">Guest Name</span><span class="val">${booking.guest_name || '—'}</span></div>
    <div class="info-row"><span class="lbl">Check-in</span><span class="val">${fmtD(booking.checkin)}</span></div>
    <div class="info-row"><span class="lbl">Check-out</span><span class="val">${fmtD(booking.checkout)}</span></div>
    <div class="info-row"><span class="lbl">Nights</span><span class="val">${nights}</span></div>
    <div class="info-row"><span class="lbl">Booking Source</span><span class="val">${PLATFORM_LABELS[platform] || platform}</span></div>
    <div class="info-row"><span class="lbl">Guest Paid (Total)</span><span class="val">${INR(totalAmt)}</span></div>
    ${isDirect
      ? `<div class="info-row"><span class="lbl">Advance (Online)</span><span class="val">${INR(booking.amount || 0)}</span></div>
         <div class="info-row"><span class="lbl">Balance (At Check-in)</span><span class="val">${INR(booking.balance_amount || 0)} ${booking.balance_paid ? '✓ Received' : '(Pending)'}</span></div>`
      : `<div class="info-row"><span class="lbl">Platform Net Payout</span><span class="val">${INR(base)}</span></div>`}
  </div>

  <div class="split">
    <div class="split-row base"><span class="lbl">${baseLabel}</span><span>${INR(base)}</span></div>
    <div class="split-row owner"><span class="lbl">🏠 Owner Share (70%)</span><span>${INR(ownerShare)}</span></div>
    <div class="split-row sd"><span class="lbl">StayDekho Share (30%)</span><span>${INR(sdShare)}</span></div>
  </div>

  <div class="footer">
    <span>StayDekho · Udaipur, Rajasthan · ${phone}</span>
    <span>${stmtNo} · Generated ${new Date().toLocaleDateString('en-IN')}</span>
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id  — cancel booking (guest or admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role !== 'admin' && booking.user_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });
    if (booking.status === 'cancelled')
      return res.status(400).json({ error: 'Booking is already cancelled' });
    if (['checked_in', 'checked_out'].includes(booking.status))
      return res.status(400).json({ error: 'Cannot cancel a booking that is already checked-in or completed' });

    await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' });

    // Auto-refund if payment was captured
    if (booking.status === 'confirmed') await initiateRefund(req.params.id);

    // Send cancellation email (non-blocking)
    const cancelled = await Booking.findById(req.params.id)
      .populate('property_id', 'name')
      .lean();
    if (cancelled) {
      const emailData = {
        ...cancelled,
        property_name: cancelled.property_id?.name,
        id:            cancelled._id.toString(),
      };
      sendEmail(
        cancelled.guest_email,
        `Booking Cancelled — #${emailData.id}`,
        bookingCancelledHtml(emailData)
      ).catch(e => console.error('Cancel email error:', e.message));

      // ── Automation: free up the calendar dates if no other booking covers them ──
      unblockCalendarIfFree(cancelled.property_id._id, cancelled.checkin, cancelled.checkout, cancelled._id)
        .catch(e => console.error('Calendar unblock error:', e.message));
    }

    res.json({ message: 'Booking cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
