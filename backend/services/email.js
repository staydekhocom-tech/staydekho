const nodemailer = require('nodemailer');

function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

async function sendEmail(to, subject, html) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n📧 Email to ${to}\nSubject: ${subject}\n(EMAIL_USER/EMAIL_PASS not set in .env)\n`);
    return;
  }
  await transporter.sendMail({
    from: `"StayDekho" <${process.env.EMAIL_USER}>`,
    to, subject, html,
  });
}

function bookingConfirmedHtml(b) {
  return `
  <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #f0e8e8">
    <div style="background:linear-gradient(135deg,#8B1717,#6b1010);padding:32px 28px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:1.5rem">Booking Confirmed!</h1>
      <p style="color:rgba(255,255,255,.8);margin:8px 0 0;font-size:.95rem">Your stay at StayDekho is all set</p>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 20px;color:#444">Hi <strong>${b.guest_name}</strong>,</p>
      <div style="background:#fdfaf9;border:1px solid #f0e8e8;border-radius:10px;padding:20px;margin-bottom:20px">
        <div style="font-size:.8rem;color:#999;text-transform:uppercase;font-weight:600;margin-bottom:12px">Booking Details</div>
        <table style="width:100%;border-collapse:collapse;font-size:.9rem">
          <tr><td style="color:#666;padding:5px 0">Property</td><td style="font-weight:600;text-align:right">${b.property_name}</td></tr>
          <tr><td style="color:#666;padding:5px 0">Booking ID</td><td style="font-weight:600;text-align:right">#${b.id}</td></tr>
          <tr><td style="color:#666;padding:5px 0">Check-in</td><td style="font-weight:600;text-align:right">${b.checkin}</td></tr>
          <tr><td style="color:#666;padding:5px 0">Check-out</td><td style="font-weight:600;text-align:right">${b.checkout}</td></tr>
          <tr><td style="color:#666;padding:5px 0">Guests</td><td style="font-weight:600;text-align:right">${b.guests}</td></tr>
          <tr style="border-top:1px solid #f0e8e8"><td style="color:#8B1717;font-weight:700;padding:8px 0 0">Total Paid</td><td style="color:#8B1717;font-weight:700;text-align:right;padding-top:8px">₹${Number(b.amount).toLocaleString('en-IN')}</td></tr>
        </table>
      </div>
      <p style="color:#666;font-size:.85rem;margin:0">Need help? Reply to this email or call us at <strong>+91 87699 05983</strong></p>
    </div>
    <div style="background:#fdfaf9;padding:16px 28px;text-align:center;border-top:1px solid #f0e8e8">
      <p style="margin:0;font-size:.8rem;color:#999">StayDekho &mdash; 6 Seth Ji Ki Bari, Madhuban, Udaipur</p>
    </div>
  </div>`;
}

function bookingCancelledHtml(b) {
  return `
  <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #f0e8e8">
    <div style="background:#444;padding:32px 28px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:1.5rem">Booking Cancelled</h1>
      <p style="color:rgba(255,255,255,.7);margin:8px 0 0;font-size:.95rem">Your booking has been cancelled</p>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 20px;color:#444">Hi <strong>${b.guest_name}</strong>,</p>
      <p style="color:#666;margin:0 0 20px">Your booking <strong>#${b.id}</strong> for <strong>${b.property_name || 'the property'}</strong> (Check-in: ${b.checkin}) has been cancelled.</p>
      <p style="color:#666;font-size:.85rem;margin:0">Questions? Call us at <strong>+91 87699 05983</strong> or email <strong>staydekho.com@gmail.com</strong></p>
    </div>
    <div style="background:#fdfaf9;padding:16px 28px;text-align:center;border-top:1px solid #f0e8e8">
      <p style="margin:0;font-size:.8rem;color:#999">StayDekho &mdash; 6 Seth Ji Ki Bari, Madhuban, Udaipur</p>
    </div>
  </div>`;
}

module.exports = { sendEmail, bookingConfirmedHtml, bookingCancelledHtml };
