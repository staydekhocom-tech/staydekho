// ╔══════════════════════════════════════════════════════╗
// ║  Interakt WhatsApp Inbox                                ║
// ║  - Interakt calls POST /webhook on every inbound reply  ║
// ║    from a lead → we save it to our own DB.               ║
// ║  - Admin panel reads/sends through the /leads routes,    ║
// ║    which call Interakt's Send Message API so the admin   ║
// ║    never has to open the Interakt dashboard.              ║
// ╚══════════════════════════════════════════════════════╝
const router = require('express').Router();
const axios  = require('axios');
const { WhatsAppLead, WhatsAppMessage } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY || '';
const INTERAKT_SEND_URL = 'https://api.interakt.ai/v1/public/message/';

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.startsWith('91') ? digits : `91${digits.slice(-10)}`;
}

async function upsertInbound(phone, name, text) {
  const p = normalizePhone(phone);
  let lead = await WhatsAppLead.findOne({ phone: p });
  if (!lead) {
    lead = await WhatsAppLead.create({ phone: p, name: name || '' });
  } else {
    lead.name           = name || lead.name;
    lead.last_message    = text;
    lead.last_direction  = 'inbound';
    lead.unread          = true;
    lead.last_msg_at     = new Date();
    await lead.save();
  }
  await WhatsAppMessage.create({
    lead_id: lead._id, direction: 'inbound', text, sender: 'guest', status: 'received',
  });
  return lead;
}

// ── Interakt inbound webhook (set this URL in Interakt dashboard) ──
router.post('/webhook', async (req, res) => {
  try {
    const body  = req.body || {};
    // Interakt sends { type: 'message_received', data: { customer: {...}, message: {...} } }
    // for an inbound text; other event types (message status, etc.) are ignored here.
    if (body.type === 'message_received') {
      const customer = body.data?.customer || {};
      const message  = body.data?.message  || {};
      const phone    = customer.phone_number || customer.countryCode + customer.phoneNumber || '';
      const name     = customer.full_name || customer.traits?.name || '';
      const text     = message.message || message.text || '';
      if (phone && text) await upsertInbound(phone, name, text);
    }
  } catch (e) {
    console.error('Interakt webhook processing error:', e.message);
  }
  res.sendStatus(200);
});

// ── Admin: list all leads, newest first ─────────────────
router.get('/leads', protect, adminOnly, async (req, res) => {
  const leads = await WhatsAppLead.find().sort({ last_msg_at: -1 }).lean();
  res.json(leads);
});

// ── Admin: full thread for one lead ─────────────────────
router.get('/leads/:id/messages', protect, adminOnly, async (req, res) => {
  const messages = await WhatsAppMessage.find({ lead_id: req.params.id }).sort({ created_at: 1 }).lean();
  res.json(messages);
});

// ── Admin: send a reply through Interakt ────────────────
router.post('/leads/:id/reply', protect, adminOnly, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });

    const lead = await WhatsAppLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (!INTERAKT_API_KEY) {
      return res.status(500).json({ error: 'INTERAKT_API_KEY not configured on server' });
    }

    await axios.post(INTERAKT_SEND_URL, {
      countryCode: '+91',
      phoneNumber: lead.phone.replace(/^91/, ''),
      type: 'Text',
      data: { message: text },
    }, {
      headers: { Authorization: `Basic ${INTERAKT_API_KEY}`, 'Content-Type': 'application/json' },
    });

    lead.last_message   = text;
    lead.last_direction = 'outbound';
    lead.unread         = false;
    lead.last_msg_at    = new Date();
    await lead.save();

    await WhatsAppMessage.create({
      lead_id: lead._id, direction: 'outbound', text,
      sender: req.user?.name || 'admin', status: 'sent',
    });

    res.json({ success: true });
  } catch (e) {
    console.error('Interakt send error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── Admin: mark a lead's thread as read ─────────────────
router.post('/leads/:id/read', protect, adminOnly, async (req, res) => {
  await WhatsAppLead.findByIdAndUpdate(req.params.id, { unread: false });
  res.json({ success: true });
});

module.exports = router;
