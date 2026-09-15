// ╔══════════════════════════════════════════════════════╗
// ║  Invoice & Payout HTML Pages                          ║
// ║  GET /invoice/:id  — guest booking receipt            ║
// ║  GET /payout/:id   — owner payout summary             ║
// ╚══════════════════════════════════════════════════════╝
const router   = require('express').Router();
const { Booking, Property } = require('../db/models');

const INR = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s || '—'; } };
const bookingCode = b => `SD-${String(b.booking_no || 0).padStart(4, '0')}`;

// ── Guest Invoice ──────────────────────────────────────
router.get('/invoice/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).send('<h2>Invoice not found</h2>');
    const property = await Property.findById(booking.property_id).lean();
    const prop = property || {};
    const code = bookingCode(booking);
    const total   = Number(booking.total_amount || booking.amount || 0);
    const advance = Number(booking.amount || 0);
    const balance = Number(booking.balance_amount || 0);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${code} — StayDekho</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;color:#222;padding:20px}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
  .header{background:#1a3c34;color:#fff;padding:24px 28px}
  .header h1{font-size:22px;font-weight:700;letter-spacing:.5px}
  .header p{font-size:13px;opacity:.8;margin-top:4px}
  .badge{display:inline-block;background:#f0c040;color:#1a3c34;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-top:8px;letter-spacing:.5px}
  .body{padding:24px 28px}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;margin-top:20px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
  .row:last-child{border-bottom:none}
  .row .label{color:#555}
  .row .value{font-weight:600;color:#222}
  .row.total .label,.row.total .value{font-size:16px;font-weight:700;color:#1a3c34}
  .row.balance .value{color:#c0392b}
  .row.paid .value{color:#27ae60}
  .divider{height:1px;background:#eee;margin:16px 0}
  .contact-box{background:#f9f9f9;border-radius:8px;padding:14px 16px;margin-top:16px;font-size:13px;line-height:1.6}
  .contact-box strong{color:#1a3c34}
  .footer{text-align:center;padding:16px;font-size:12px;color:#aaa;background:#fafafa;border-top:1px solid #f0f0f0}
  @media print{body{background:#fff;padding:0}.card{box-shadow:none;border-radius:0}}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>StayDekho</h1>
    <p>Booking Invoice</p>
    <div class="badge">${code}</div>
  </div>
  <div class="body">
    <div class="section-title">Guest Details</div>
    <div class="row"><span class="label">Guest Name</span><span class="value">${booking.guest_name || '—'}</span></div>
    ${booking.guest_phone ? `<div class="row"><span class="label">Phone</span><span class="value">${booking.guest_phone}</span></div>` : ''}
    ${booking.guest_email ? `<div class="row"><span class="label">Email</span><span class="value">${booking.guest_email}</span></div>` : ''}

    <div class="section-title">Stay Details</div>
    <div class="row"><span class="label">Property</span><span class="value">${prop.name || 'StayDekho Property'}</span></div>
    <div class="row"><span class="label">Check-in</span><span class="value">${fmtD(booking.checkin)}</span></div>
    <div class="row"><span class="label">Check-out</span><span class="value">${fmtD(booking.checkout)}</span></div>
    <div class="row"><span class="label">Duration</span><span class="value">${booking.nights || 1} night${(booking.nights || 1) > 1 ? 's' : ''} · ${booking.guests || 1} guest${(booking.guests || 1) > 1 ? 's' : ''}</span></div>

    <div class="section-title">Payment Summary</div>
    <div class="row total"><span class="label">Total Amount</span><span class="value">₹${INR(total)}</span></div>
    <div class="row paid"><span class="label">Advance Paid</span><span class="value">−₹${INR(advance)}</span></div>
    ${balance > 0
      ? `<div class="row balance"><span class="label">Balance Due at Check-in</span><span class="value">₹${INR(balance)}</span></div>`
      : `<div class="row paid"><span class="label">Balance</span><span class="value">Fully Paid ✓</span></div>`
    }

    ${prop.caretaker_name || prop.caretaker_phone ? `
    <div class="contact-box">
      <strong>Property Contact</strong><br>
      ${prop.caretaker_name ? `${prop.caretaker_name}` : ''}${prop.caretaker_phone ? ` · ${prop.caretaker_phone}` : ''}
    </div>` : ''}
  </div>
  <div class="footer">
    Thank you for choosing StayDekho · ${process.env.BUSINESS_PHONE || '+91 87699 05983'} · staydekho.com
  </div>
</div>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

// ── Owner Payout Summary ───────────────────────────────
router.get('/payout/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).send('<h2>Payout record not found</h2>');
    const property = await Property.findById(booking.property_id).lean();
    const prop = property || {};
    const code = bookingCode(booking);

    const total      = Number(booking.total_amount || booking.amount || 0);
    const remitted   = Number(booking.remitted_tax || 0);
    const net        = total - remitted;
    const ownerShare = Math.round(net * 0.7);
    const staydekho  = net - ownerShare;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payout ${code} — StayDekho</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;color:#222;padding:20px}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
  .header{background:#2c4a3e;color:#fff;padding:24px 28px}
  .header h1{font-size:22px;font-weight:700}
  .header p{font-size:13px;opacity:.8;margin-top:4px}
  .badge{display:inline-block;background:#a8d8a8;color:#1a3c34;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-top:8px;letter-spacing:.5px}
  .body{padding:24px 28px}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;margin-top:20px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
  .row:last-child{border-bottom:none}
  .row .label{color:#555}
  .row .value{font-weight:600;color:#222}
  .row.highlight .label,.row.highlight .value{font-size:16px;font-weight:700;color:#2c4a3e;background:#f0faf0;padding:10px 12px;border-radius:8px;width:100%;display:flex;justify-content:space-between}
  .row.highlight{padding:0;border:none;margin-top:8px}
.footer{text-align:center;padding:16px;font-size:12px;color:#aaa;background:#fafafa;border-top:1px solid #f0f0f0}
  @media print{body{background:#fff;padding:0}.card{box-shadow:none;border-radius:0}}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>StayDekho</h1>
    <p>Owner Payout Summary</p>
    <div class="badge">${code}</div>
  </div>
  <div class="body">
    <div class="section-title">Booking Details</div>
    <div class="row"><span class="label">Property</span><span class="value">${prop.name || 'StayDekho Property'}</span></div>
    <div class="row"><span class="label">Guest</span><span class="value">${booking.guest_name || '—'}</span></div>
    <div class="row"><span class="label">Check-in</span><span class="value">${fmtD(booking.checkin)}</span></div>
    <div class="row"><span class="label">Check-out</span><span class="value">${fmtD(booking.checkout)}</span></div>
    <div class="row"><span class="label">Nights · Guests</span><span class="value">${booking.nights || 1} nights · ${booking.guests || 1} guests</span></div>

    <div class="section-title">Payout Breakdown</div>
    <div class="row"><span class="label">Net Amount</span><span class="value">₹${INR(net)}</span></div>
    <div class="row highlight">
      <span class="label" style="color:#2c4a3e">Your Payout (70%)</span>
      <span class="value" style="color:#2c4a3e">₹${INR(ownerShare)}</span>
    </div>
    <div class="row" style="margin-top:8px"><span class="label" style="color:#999;font-size:12px">StayDekho Share (30%)</span><span class="value" style="color:#999;font-size:12px">₹${INR(staydekho)}</span></div>

    <div class="section-title">Status</div>
    <div class="row"><span class="label">Payment Status</span><span class="value" style="color:${booking.owner_paid ? '#27ae60' : '#e67e22'}">${booking.owner_paid ? '✓ Paid' : 'Pending'}</span></div>
    ${booking.owner_paid_at ? `<div class="row"><span class="label">Paid On</span><span class="value">${fmtD(booking.owner_paid_at)}</span></div>` : ''}
  </div>
  <div class="footer">
    StayDekho · ${process.env.BUSINESS_PHONE || '+91 87699 05983'} · staydekho.com
  </div>
</div>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

module.exports = router;
