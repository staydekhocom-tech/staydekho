const { sendWhatsApp } = require('./whatsapp');

function notifyStaffNewBooking(staff, booking, propertyName) {
  if (!staff?.phone) return;
  const msg =
    `New booking at ${propertyName}!\n` +
    `Guest: ${booking.guest_name}\n` +
    `Check-in: ${booking.checkin}\n` +
    `Check-out: ${booking.checkout}\n` +
    `Guests: ${booking.guests}`;
  sendWhatsApp(staff.phone, msg).catch(() => {});
}

function notifyGuestRoomReady(guestPhone, guestName, checkinLink) {
  if (!guestPhone) return;
  const msg =
    `Hello ${guestName}! Your room is ready ✅\n` +
    `Please view room photos & sign house rules:\n${checkinLink}\n` +
    `See you soon! - StayDekho`;
  sendWhatsApp(guestPhone, msg).catch(() => {});
}

function notifyAdminGuestSigned(adminPhone, guestName, propertyName) {
  if (!adminPhone) return;
  const msg = `✅ ${guestName} has signed the house rules for ${propertyName}.`;
  sendWhatsApp(adminPhone, msg).catch(() => {});
}

function notifyAdminIssue(adminPhone, staffName, propertyName, issueTitle) {
  if (!adminPhone) return;
  const msg =
    `⚠️ Issue reported at ${propertyName} by ${staffName}:\n` +
    `"${issueTitle}"\nCheck admin panel for details.`;
  sendWhatsApp(adminPhone, msg).catch(() => {});
}

module.exports = { notifyStaffNewBooking, notifyGuestRoomReady, notifyAdminGuestSigned, notifyAdminIssue };
