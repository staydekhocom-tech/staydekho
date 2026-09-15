// ╔══════════════════════════════════════════════════════╗
// ║  Daily WhatsApp Reminder Scheduler                    ║
// ║  10:00 AM IST (04:30 UTC) every day                  ║
// ║  • Check-in reminder → guests checking in tomorrow   ║
// ║  • Caretaker alert   → caretaker for tomorrow's stay ║
// ║  • Balance reminder  → balance_amount > 0            ║
// ║  • Review request    → guests who checked out today  ║
// ╚══════════════════════════════════════════════════════╝
const cron = require('node-cron');
const { Booking } = require('../db/models');
const {
  notifyGuestCheckinReminder,
  notifyCaretakerCheckinReminder,
  notifyGuestBalanceDue,
  notifyGuestReviewRequest,
  notifyGuestStayCheckin,
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
    }).populate('property_id', 'name caretaker_name caretaker_phone manager_name manager_phone map_url travel_guide_url').lean();

    for (const b of arriving) {
      const prop = b.property_id || {};
      await notifyGuestCheckinReminder(b, prop).catch(() => {});
      if (b.balance_amount > 0) {
        await notifyGuestBalanceDue(b, prop.name || 'StayDekho Property').catch(() => {});
      }
      // Caretaker gets the same-day guest details
      await notifyCaretakerCheckinReminder(b, prop).catch(() => {});
      // Manager also gets caretaker-style reminder (reuse same function, same template)
      if (prop.manager_phone) {
        await notifyCaretakerCheckinReminder(b, {
          ...prop,
          caretaker_name:  prop.manager_name  || prop.caretaker_name,
          caretaker_phone: prop.manager_phone,
        }).catch(() => {});
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

async function runEveningWelfare() {
  try {
    const today = istDate(0);
    console.log(`🌅 Evening welfare check: checkin_today=${today}`);

    const checkedInToday = await Booking.find({
      checkin:     today,
      status:      { $in: ['confirmed', 'checked_in'] },
      guest_phone: { $exists: true, $ne: '' },
    }).populate('property_id', 'name caretaker_phone').lean();

    for (const b of checkedInToday) {
      const propName     = b.property_id?.name || 'StayDekho Property';
      const contactPhone = b.property_id?.caretaker_phone || process.env.BUSINESS_PHONE || '';
      await notifyGuestStayCheckin(b, propName, contactPhone).catch(() => {});
    }

    console.log(`✅ Evening welfare done — ${checkedInToday.length} guests`);
  } catch (err) {
    console.error('❌ Evening welfare scheduler error:', err.message);
  }
}

function startScheduler() {
  // 04:30 UTC = 10:00 AM IST — morning reminders + caretaker alerts
  cron.schedule('30 4 * * *', runDailyReminders, { timezone: 'UTC' });
  // 12:30 UTC = 6:00 PM IST — evening welfare check
  cron.schedule('30 12 * * *', runEveningWelfare, { timezone: 'UTC' });
  console.log('⏰ WhatsApp schedulers started — 10:00 AM & 6:00 PM IST daily');
}

module.exports = { startScheduler, runDailyReminders, runEveningWelfare };
