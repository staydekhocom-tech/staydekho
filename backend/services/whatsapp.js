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

// ── Booking notification: owner + caretaker + manager ──
async function notifyTeamNewBooking(booking, property) {
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  const INR  = n => Number(n || 0).toLocaleString('en-IN');

  // Owner — template (payout breakdown)
  if (property?.owner_phone) {
    const total      = Number(booking.total_amount || booking.amount || 0);
    const remitted   = Number(booking.remitted_tax || 0);
    const net        = total - remitted;
    const ownerShare = Math.round(net * 0.7);
    sendWhatsAppTemplate(property.owner_phone, 'staydekho_owner_new_booking', [
      property.owner_name || 'ji',
      property.name || 'Property',
      booking.guest_name || '—',
      fmtD(booking.checkin),
      fmtD(booking.checkout),
      String(booking.nights || 1),
      String(booking.guests || 1),
      INR(net),
      INR(ownerShare),
      `${process.env.FRONTEND_URL || 'https://staydekho.com'}/payout/${booking._id}`,
    ]).catch(() => {});
  }

  // Caretaker — template (Hinglish)
  if (property?.caretaker_phone) {
    sendWhatsAppTemplate(property.caretaker_phone, 'staydekho_caretaker_new_booking', [
      property.caretaker_name || 'ji',
      property.name || 'Property',
      booking.guest_name || '—',
      booking.guest_phone || '—',
      fmtD(booking.checkin),
      fmtD(booking.checkout),
      String(booking.guests || 1),
    ]).catch(() => {});
  }

  // Manager — same as caretaker template
  if (property?.manager_phone) {
    sendWhatsAppTemplate(property.manager_phone, 'staydekho_caretaker_new_booking', [
      property.manager_name || 'ji',
      property.name || 'Property',
      booking.guest_name || '—',
      booking.guest_phone || '—',
      fmtD(booking.checkin),
      fmtD(booking.checkout),
      String(booking.guests || 1),
    ]).catch(() => {});
  }
}

// ── Cancellation notification ───────────────────────────
async function notifyTeamBookingCancelled(booking, property) {
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  const params = [
    property?.owner_name || 'ji',
    property?.name || 'Property',
    booking.guest_name || '—',
    fmtD(booking.checkin),
    fmtD(booking.checkout),
  ];
  const careParams = [
    property?.caretaker_name || 'ji',
    property?.name || 'Property',
    booking.guest_name || '—',
    fmtD(booking.checkin),
    fmtD(booking.checkout),
  ];

  if (property?.owner_phone)     sendWhatsAppTemplate(property.owner_phone, 'staydekho_owner_cancelled', params).catch(() => {});
  if (property?.caretaker_phone) sendWhatsAppTemplate(property.caretaker_phone, 'staydekho_caretaker_cancelled', careParams).catch(() => {});
  if (property?.manager_phone)   sendWhatsAppTemplate(property.manager_phone, 'staydekho_caretaker_cancelled', [
    property.manager_name || 'ji', ...careParams.slice(1)
  ]).catch(() => {});
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
// property can be a Property object or just a name string (backwards compat)
async function notifyGuestBookingConfirmed(booking, property) {
  if (!booking.guest_phone) return;
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  const INR  = n => Number(n || 0).toLocaleString('en-IN');
  const prop        = typeof property === 'string' ? { name: property } : (property || {});
  const propName    = prop.name || 'StayDekho Property';
  const bookingCode = `SD-${String(booking.booking_no || 0).padStart(4, '0')}`;
  const contact     = process.env.BUSINESS_PHONE || '+91 87699 05983';
  const invoiceUrl  = `${process.env.FRONTEND_URL || 'https://staydekho.com'}/invoice/${booking._id || bookingCode}`;
  sendWhatsAppTemplate(booking.guest_phone, 'staydekho_booking_confirmed', [
    booking.guest_name || 'Guest',          // {{1}}
    propName,                                // {{2}}
    fmtD(booking.checkin),                   // {{3}}
    fmtD(booking.checkout),                  // {{4}}
    String(booking.nights || 1),             // {{5}}
    String(booking.guests || 1),             // {{6}}
    bookingCode,                             // {{7}}
    INR(booking.amount || 0),                // {{8}} advance paid
    INR(booking.balance_amount || 0),        // {{9}} balance
    invoiceUrl,                              // {{10}} invoice link
    prop.caretaker_name || 'StayDekho Team', // {{11}}
    prop.caretaker_phone || contact,         // {{12}}
    prop.map_url || '',                      // {{13}} maps link
    contact,                                 // {{14}}
  ]).catch(() => {});
}

// ── Guest: check-in reminder (called by scheduler) ────────
async function notifyGuestCheckinReminder(booking, property) {
  if (!booking.guest_phone) return;
  const fmtD    = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  const prop    = typeof property === 'string' ? { name: property } : (property || {});
  const INR     = n => Number(n || 0).toLocaleString('en-IN');
  const contact = process.env.BUSINESS_PHONE || '+91 87699 05983';
  return sendWhatsAppTemplate(booking.guest_phone, 'staydekho_checkin_reminder', [
    booking.guest_name || 'Guest',                          // {{1}}
    prop.name || 'StayDekho Property',                      // {{2}}
    fmtD(booking.checkin),                                  // {{3}}
    fmtD(booking.checkout),                                 // {{4}}
    prop.caretaker_name || 'StayDekho Team',                // {{5}}
    prop.caretaker_phone || contact,                        // {{6}}
    INR(booking.balance_amount || 0),                       // {{7}}
    prop.travel_guide_url || contact,                       // {{8}}
  ]);
}

// ── Caretaker: check-in reminder (called by scheduler) ────
async function notifyCaretakerCheckinReminder(booking, property) {
  if (!property?.caretaker_phone) return;
  const fmtD = s => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
  return sendWhatsAppTemplate(property.caretaker_phone, 'staydekho_caretaker_checkin_reminder', [
    property.caretaker_name || 'ji',   // {{1}}
    property.name || 'Property',        // {{2}}
    booking.guest_name || '—',          // {{3}}
    booking.guest_phone || '—',         // {{4}}
    fmtD(booking.checkin),              // {{5}}
    fmtD(booking.checkout),             // {{6}}
    String(booking.guests || 1),        // {{7}}
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

// ── Guest: balance payment received (1 hr delay) ──────────
async function notifyGuestPaymentReceived(booking, propertyName) {
  if (!booking.guest_phone) return;
  const INR = n => Number(n || 0).toLocaleString('en-IN');
  return sendWhatsAppTemplate(booking.guest_phone, 'staydekho_payment_received', [
    booking.guest_name || 'Guest',
    INR(booking.balance_amount),
    propertyName,
    process.env.BUSINESS_PHONE || '+91 87699 05983',
  ]);
}

// ── Guest: evening check-in day welfare check ─────────────
async function notifyGuestStayCheckin(booking, propertyName, contactPhone) {
  if (!booking.guest_phone) return;
  return sendWhatsAppTemplate(booking.guest_phone, 'staydekho_stay_checkin', [
    booking.guest_name || 'Guest',
    propertyName,
    contactPhone || process.env.BUSINESS_PHONE || '+91 87699 05983',
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
  notifyCaretakerCheckinReminder,
  notifyGuestBalanceDue,
  notifyGuestPaymentReceived,
  notifyGuestStayCheckin,
  notifyGuestReviewRequest,
};
