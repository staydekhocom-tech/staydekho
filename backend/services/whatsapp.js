// ╔══════════════════════════════════════════════════════╗
// ║  WhatsApp Notifications — Meta Cloud API              ║
// ║  Booking bante hi owner + caretaker + admin ko update ║
// ║  Keys nahi hain toh sirf console pe log hota hai      ║
// ╚══════════════════════════════════════════════════════╝
const axios = require('axios');

const configured = () =>
  !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;

// Sirf digits; 10-digit Indian number ho toh 91 laga do
function cleanPhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.length === 10) p = '91' + p;
  return p;
}

async function sendWhatsApp(phone, message) {
  const to = cleanPhone(phone);
  if (!to) return { success: false, reason: 'no phone' };

  if (!configured()) {
    console.log(`📱 [WhatsApp DRY-RUN — keys nahi hain] To +${to}:\n${message}\n`);
    return { success: false, reason: 'not configured' };
  }

  try {
    const r = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: message },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ WhatsApp sent to +${to}`);
    return { success: true, messageId: r.data.messages?.[0]?.id };
  } catch (err) {
    console.error(`❌ WhatsApp failed to +${to}:`, err.response?.data?.error?.message || err.message);
    return { success: false, reason: err.message };
  }
}

// ── Booking notification: owner + caretaker + admin ────
// property: { name, owner_name, owner_phone, caretaker_name, caretaker_phone }
async function notifyTeamNewBooking(booking, property) {
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  const INR  = n => '₹' + Number(n || 0).toLocaleString('en-IN');

  // Guest ka phone number sirf ADMIN ko jaata hai — owner/caretaker ko nahi
  const base =
    `🏠 *Nayi Booking — ${property?.name || 'Property'}*\n\n` +
    `👤 Guest: ${booking.guest_name || '—'}\n` +
    `📅 Check-in: ${fmtD(booking.checkin)}\n` +
    `📅 Check-out: ${fmtD(booking.checkout)}\n` +
    `🌙 Nights: ${booking.nights || 1} | Guests: ${booking.guests || 1}\n`;

  // Owner ko — amount ke saath (guest phone NAHI)
  if (property?.owner_phone) {
    const msg = base +
      `💰 Total: ${INR(booking.total_amount || booking.amount)}\n\n` +
      `— StayDekho`;
    sendWhatsApp(property.owner_phone, msg).catch(() => {});
  }

  // Caretaker ko — amount aur guest phone dono NAHI, sirf operations info
  if (property?.caretaker_phone) {
    const msg = base +
      `\n🧹 Room taiyaar rakhna. Check-in 2 PM se.\n\n— StayDekho`;
    sendWhatsApp(property.caretaker_phone, msg).catch(() => {});
  }

  // Admin (Sanskar) ko — full detail (guest phone bhi)
  if (process.env.ADMIN_WHATSAPP) {
    const msg = base +
      `📞 Guest Phone: ${booking.guest_phone || '—'}\n` +
      `💰 Total: ${INR(booking.total_amount || booking.amount)} | Advance: ${INR(booking.amount)}\n` +
      `📌 Source: ${booking.platform || 'direct'}\n\n— StayDekho System`;
    sendWhatsApp(process.env.ADMIN_WHATSAPP, msg).catch(() => {});
  }
}

// ── Cancellation notification ───────────────────────────
async function notifyTeamBookingCancelled(booking, property) {
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return s; } };
  const msg =
    `❌ *Booking Cancel — ${property?.name || 'Property'}*\n\n` +
    `👤 ${booking.guest_name || '—'} | ${fmtD(booking.checkin)} → ${fmtD(booking.checkout)}\n` +
    `Calendar unblock ho gaya hai.\n\n— StayDekho`;

  if (property?.owner_phone)     sendWhatsApp(property.owner_phone, msg).catch(() => {});
  if (property?.caretaker_phone) sendWhatsApp(property.caretaker_phone, msg).catch(() => {});
  if (process.env.ADMIN_WHATSAPP) sendWhatsApp(process.env.ADMIN_WHATSAPP, msg).catch(() => {});
}

// ── Template message sender (for guest outbound messages) ─
// Meta requires pre-approved templates for business-initiated messages.
//
// Templates to create in Meta Business Manager → WhatsApp → Message Templates:
//
// 1. Name: staydekho_booking_confirmed  Category: UTILITY  Language: English
//    Body: "Hello {{1}}, your booking at *{{2}}* is confirmed! 🏠\n\n📅 Check-in: {{3}}\n📅 Check-out: {{4}}\n🌙 {{5}} nights | {{6}} guests\n🔖 Booking ID: {{7}}\n\nFor help: {{8}}\nThank you for choosing StayDekho!"
//
// 2. Name: staydekho_checkin_reminder  Category: UTILITY  Language: English
//    Body: "Hello {{1}}, your stay at *{{2}}* begins tomorrow! 🏡\n\n📅 Check-in: {{3}} after 2:00 PM\n📞 Contact us: {{4}}\n\nSee you soon! — StayDekho"
//
// 3. Name: staydekho_balance_reminder  Category: UTILITY  Language: English
//    Body: "Hello {{1}}, reminder for your upcoming stay at *{{2}}*.\n\n💰 Balance due at check-in: ₹{{3}}\nPlease have the amount ready.\n\n— StayDekho"
//
// 4. Name: staydekho_review_request  Category: MARKETING  Language: English
//    Body: "Hello {{1}}, we hope you enjoyed your stay at *{{2}}*! 🌟\n\nYour feedback means a lot to us and helps future guests.\n\nThank you for choosing StayDekho! 🙏"
//
// After approval, set env var: WHATSAPP_LANG=en (or en_US / en_GB)
// ─────────────────────────────────────────────────────────────

async function sendWhatsAppTemplate(phone, templateName, params = []) {
  const to = cleanPhone(phone);
  if (!to) return { success: false, reason: 'no phone' };

  if (!configured()) {
    console.log(`📱 [WA TEMPLATE DRY-RUN] +${to} | ${templateName} | params: ${params.join(', ')}`);
    return { success: false, reason: 'not configured' };
  }

  try {
    const r = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_LANG || 'en' },
          components: params.length ? [{
            type: 'body',
            parameters: params.map(p => ({ type: 'text', text: String(p) })),
          }] : [],
        },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ WA template '${templateName}' sent to +${to}`);
    return { success: true, messageId: r.data.messages?.[0]?.id };
  } catch (err) {
    console.error(`❌ WA template '${templateName}' failed +${to}:`, err.response?.data?.error?.message || err.message);
    return { success: false, reason: err.message };
  }
}

// ── Guest: booking confirmed ───────────────────────────────
async function notifyGuestBookingConfirmed(booking, propertyName) {
  if (!booking.guest_phone) return;
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  const bookingCode = `SD-${String(booking.booking_no || 0).padStart(4, '0')}`;
  const contact = process.env.BUSINESS_PHONE || '+91 87699 05983';
  sendWhatsAppTemplate(booking.guest_phone, 'staydekho_booking_confirmed', [
    booking.guest_name || 'Guest',
    propertyName,
    fmtD(booking.checkin),
    fmtD(booking.checkout),
    String(booking.nights || 1),
    String(booking.guests || 1),
    bookingCode,
    contact,
  ]).catch(() => {});
}

// ── Guest: check-in reminder (called by scheduler) ────────
async function notifyGuestCheckinReminder(booking, propertyName, contactPhone) {
  if (!booking.guest_phone) return;
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  return sendWhatsAppTemplate(booking.guest_phone, 'staydekho_checkin_reminder', [
    booking.guest_name || 'Guest',
    propertyName,
    fmtD(booking.checkin),
    contactPhone || process.env.BUSINESS_PHONE || '+91 87699 05983',
  ]);
}

// ── Guest: balance due reminder ────────────────────────────
async function notifyGuestBalanceDue(booking, propertyName) {
  if (!booking.guest_phone || !(booking.balance_amount > 0)) return;
  const INR = n => Number(n || 0).toLocaleString('en-IN');
  return sendWhatsAppTemplate(booking.guest_phone, 'staydekho_balance_reminder', [
    booking.guest_name || 'Guest',
    propertyName,
    INR(booking.balance_amount),
  ]);
}

// ── Guest: review request (called by scheduler) ───────────
async function notifyGuestReviewRequest(booking, propertyName) {
  if (!booking.guest_phone) return;
  return sendWhatsAppTemplate(booking.guest_phone, 'staydekho_review_request', [
    booking.guest_name || 'Guest',
    propertyName,
  ]);
}

module.exports = {
  sendWhatsApp,
  sendWhatsAppTemplate,
  notifyTeamNewBooking,
  notifyTeamBookingCancelled,
  notifyGuestBookingConfirmed,
  notifyGuestCheckinReminder,
  notifyGuestBalanceDue,
  notifyGuestReviewRequest,
};
