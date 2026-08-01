const https = require('https');

function sendWhatsApp(phone, message) {
  const clean = String(phone).replace(/\D/g, '').slice(-10);
  if (!clean || clean.length < 10) return;

  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) {
    const payload = JSON.stringify({
      template_id: process.env.MSG91_TEMPLATE_ID,
      recipients: [{ mobiles: `91${clean}`, message }],
    });
    const req = https.request({
      hostname: 'api.msg91.com',
      path: '/api/v5/flow/',
      method: 'POST',
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
    });
    req.on('error', e => console.error('MSG91 WhatsApp error:', e.message));
    req.write(payload);
    req.end();
  }

  console.log(`📱 WhatsApp → +91${clean}: ${message}`);
}

function notifyStaffNewBooking(staff, booking, propertyName) {
  if (!staff?.phone) return;
  const msg = `New booking at ${propertyName}!\nGuest: ${booking.guest_name}\nCheck-in: ${booking.checkin}\nCheck-out: ${booking.checkout}\nGuests: ${booking.guests}`;
  sendWhatsApp(staff.phone, msg);
}

function notifyGuestRoomReady(guestPhone, guestName, checkinLink) {
  if (!guestPhone) return;
  const msg = `Hello ${guestName}! Your room is ready ✅\nPlease view room photos & sign house rules:\n${checkinLink}\nSee you soon! - StayDekho`;
  sendWhatsApp(guestPhone, msg);
}

function notifyAdminGuestSigned(adminPhone, guestName, propertyName) {
  if (!adminPhone) return;
  const msg = `✅ ${guestName} has signed the house rules for ${propertyName}.`;
  sendWhatsApp(adminPhone, msg);
}

function notifyAdminIssue(adminPhone, staffName, propertyName, issueTitle) {
  if (!adminPhone) return;
  const msg = `⚠️ Issue reported at ${propertyName} by ${staffName}:\n"${issueTitle}"\nCheck admin panel for details.`;
  sendWhatsApp(adminPhone, msg);
}

module.exports = { notifyStaffNewBooking, notifyGuestRoomReady, notifyAdminGuestSigned, notifyAdminIssue };
