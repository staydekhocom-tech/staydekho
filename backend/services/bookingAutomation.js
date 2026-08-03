// ╔══════════════════════════════════════════════════════╗
// ║  Booking Automation — single source of truth chain   ║
// ║  Booking create/edit/cancel → auto calendar block,   ║
// ║  auto cleaning task, auto guest notification          ║
// ╚══════════════════════════════════════════════════════╝
const { DatePrice, CleaningTask, Booking } = require('../db/models');
const { sendEmail, bookingConfirmedHtml, bookingCancelledHtml } = require('./email');
const { sendSMS } = require('./sms');
const { notifyGuestBookingConfirmed } = require('./whatsapp');

function dateRange(checkin, checkout) {
  const dates = [];
  const cur = new Date(checkin);
  const end = new Date(checkout);
  while (cur < end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Block every night of the stay on the property's availability calendar
async function blockCalendarForBooking(propertyId, checkin, checkout) {
  for (const date of dateRange(checkin, checkout)) {
    await DatePrice.findOneAndUpdate(
      { property_id: propertyId, date },
      { property_id: propertyId, date, blocked: true },
      { upsert: true, new: true }
    );
  }
}

// Unblock a date range, but only the nights that have no OTHER active booking covering them
async function unblockCalendarIfFree(propertyId, checkin, checkout, excludeBookingId) {
  for (const date of dateRange(checkin, checkout)) {
    const overlap = await Booking.findOne({
      property_id: propertyId,
      _id:         { $ne: excludeBookingId },
      status:      { $nin: ['cancelled'] },
      checkin:     { $lte: date },
      checkout:    { $gt: date },
    }).lean();
    if (!overlap) {
      await DatePrice.findOneAndUpdate({ property_id: propertyId, date }, { blocked: false });
    }
  }
}

// Auto-create a pending cleaning task for the checkout date
async function createCleaningTaskForCheckout(propertyId, checkoutDate) {
  await CleaningTask.findOneAndUpdate(
    { property_id: propertyId, date: checkoutDate },
    { property_id: propertyId, date: checkoutDate, checkout_today: true, $setOnInsert: { status: 'pending' } },
    { upsert: true, new: true }
  );
}

// Guest notifications (non-blocking — failures are logged, never break the booking flow)
async function notifyGuestBookingCreated(booking, propertyName) {
  const data = { ...booking, property_name: propertyName, id: booking._id?.toString() || booking.id };
  if (booking.guest_email) {
    sendEmail(booking.guest_email, `Booking Confirmed — #${data.id} | StayDekho`, bookingConfirmedHtml(data))
      .catch(e => console.error('Booking confirm email error:', e.message));
  }
  if (booking.guest_phone) {
    const msg = `StayDekho: Booking confirmed at ${propertyName}! Check-in ${booking.checkin}, Check-out ${booking.checkout}. Thank you for choosing us.`;
    sendSMS(booking.guest_phone, msg).catch(e => console.error('Booking confirm SMS error:', e.message));
    notifyGuestBookingConfirmed(booking, propertyName);
  }
}

async function notifyGuestBookingCancelled(booking, propertyName) {
  const data = { ...booking, property_name: propertyName, id: booking._id?.toString() || booking.id };
  if (booking.guest_email) {
    sendEmail(booking.guest_email, `Booking Cancelled — #${data.id} | StayDekho`, bookingCancelledHtml(data))
      .catch(e => console.error('Booking cancel email error:', e.message));
  }
  if (booking.guest_phone) {
    const msg = `StayDekho: Your booking at ${propertyName} (Check-in ${booking.checkin}) has been cancelled.`;
    sendSMS(booking.guest_phone, msg).catch(e => console.error('Booking cancel SMS error:', e.message));
  }
}

module.exports = {
  dateRange,
  blockCalendarForBooking,
  unblockCalendarIfFree,
  createCleaningTaskForCheckout,
  notifyGuestBookingCreated,
  notifyGuestBookingCancelled,
};
