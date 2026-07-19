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

module.exports = { sendWhatsApp, notifyTeamNewBooking, notifyTeamBookingCancelled };
