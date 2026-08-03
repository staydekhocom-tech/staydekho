// ╔══════════════════════════════════════════════════════╗
// ║  Daily WhatsApp Reminder Scheduler                    ║
// ║  10:00 AM IST (04:30 UTC) every day                  ║
// ║  • Check-in reminder → guests checking in tomorrow   ║
// ║  • Balance reminder  → balance_amount > 0            ║
// ║  • Review request    → guests who checked out today  ║
// ╚══════════════════════════════════════════════════════╝
const cron = require('node-cron');
const { Booking } = require('../db/models');
const {
  notifyGuestCheckinReminder,
  notifyGuestBalanceDue,
  notifyGuestReviewRequest,
} = require('./whatsapp');

function istDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

async function runDailyReminders() {
  try {
    const tomorrow  = istDate(+1);
    const yesterday = istDate(-1);
    console.log(`⏰ Daily WA reminders: checkin_tomorrow=${tomorrow}, checkout_yesterday=${yesterday}`);

    // ── Check-in reminders ────────────────────────────────
    const arriving = await Booking.find({
      checkin:     tomorrow,
      status:      'confirmed',
      guest_phone: { $exists: true, $ne: '' },
    }).populate('property_id', 'name phone').lean();

    for (const b of arriving) {
      const propName  = b.property_id?.name  || 'StayDekho Property';
      const propPhone = b.property_id?.phone || process.env.BUSINESS_PHONE || '';
      await notifyGuestCheckinReminder(b, propName, propPhone).catch(() => {});
      if (b.balance_amount > 0) {
        await notifyGuestBalanceDue(b, propName).catch(() => {});
      }
    }

    // ── Review requests ───────────────────────────────────
    const departed = await Booking.find({
      checkout:    yesterday,
      status:      { $in: ['checked_out', 'confirmed'] },
      guest_phone: { $exists: true, $ne: '' },
    }).populate('property_id', 'name').lean();

    for (const b of departed) {
      const propName = b.property_id?.name || 'StayDekho Property';
      await notifyGuestReviewRequest(b, propName).catch(() => {});
    }

    console.log(`✅ WA reminders done — ${arriving.length} check-in, ${departed.length} review`);
  } catch (err) {
    console.error('❌ Daily WA scheduler error:', err.message);
  }
}

function startScheduler() {
  // 04:30 UTC = 10:00 AM IST
  cron.schedule('30 4 * * *', runDailyReminders, { timezone: 'UTC' });
  console.log('⏰ Daily WhatsApp scheduler started — runs 10:00 AM IST every day');
}

module.exports = { startScheduler, runDailyReminders };
