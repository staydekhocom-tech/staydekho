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
    lead = await WhatsAppLead.create({ phone: p, name: name || '', last_message: text, last_direction: 'inbound', last_msg_at: new Date() });
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

// For replies sent from Interakt's own dashboard/app (not through our admin
// panel) — the "echo" webhook event. Same bookkeeping as a reply sent via
// POST /leads/:id/reply, except the lead must already exist (an echo always
// follows an inbound message, so there's nothing to create here).
async function upsertOutbound(phone, text) {
  const p = normalizePhone(phone);
  const lead = await WhatsAppLead.findOne({ phone: p });
  if (!lead) return null;
  lead.last_message   = text;
  lead.last_direction = 'outbound';
  lead.unread         = false;
  lead.last_msg_at    = new Date();
  await lead.save();
  await WhatsAppMessage.create({
    lead_id: lead._id, direction: 'outbound', text, sender: 'interakt-app', status: 'sent',
  });
  return lead;
}

// ── Interakt inbound webhook (set this URL in Interakt dashboard) ──
router.post('/webhook', async (req, res) => {
  try {
    const body  = req.body || {};
    if (body.type === 'message_received') {
      // A customer's inbound message.
      const customer = body.data?.customer || {};
      const message  = body.data?.message  || {};
      const phone    = customer.phone_number || customer.countryCode + customer.phoneNumber || '';
      const name     = customer.full_name || customer.traits?.name || '';
      const text     = message.message || message.text || '';
      if (phone && text) await upsertInbound(phone, name, text);
    } else if (/echo/i.test(body.type || '') || /message_sent/i.test(body.type || '')) {
      // A reply sent from Interakt's own dashboard/app, not through us —
      // exact payload shape unconfirmed yet, so log it and try our best guess.
      console.log('📤 Interakt echo webhook payload:', JSON.stringify(body));
      const customer = body.data?.customer || {};
      const message  = body.data?.message  || {};
      const phone    = customer.phone_number || customer.countryCode + customer.phoneNumber || '';
      const text     = message.message || message.text || '';
      if (phone && text) await upsertOutbound(phone, text);
    } else {
      console.log('ℹ️ Unhandled Interakt webhook type:', body.type, JSON.stringify(body).slice(0, 500));
    }
  } catch (e) {
    console.error('Interakt webhook processing error:', e.message);
  }
  res.sendStatus(200);
});

// .lean() skips the schema's toJSON transform (no virtual "id", _id stays as
// an ObjectId) — add a plain string id back on so the frontend's l.id works.
const withId = doc => ({ ...doc, id: doc._id.toString() });

// ── Admin: list all leads, newest first ─────────────────
router.get('/leads', protect, adminOnly, async (req, res) => {
  const leads = await WhatsAppLead.find().sort({ last_msg_at: -1 }).lean();
  res.json(leads.map(withId));
});

// ── Admin: full thread for one lead ─────────────────────
router.get('/leads/:id/messages', protect, adminOnly, async (req, res) => {
  const messages = await WhatsAppMessage.find({ lead_id: req.params.id }).sort({ created_at: 1 }).lean();
  res.json(messages.map(withId));
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

// ── Admin: send a photo/document (already uploaded to Cloudinary via
// POST /api/uploads/image) through Interakt ──
// NOTE: Interakt's exact field names for media messages aren't confirmed —
// this follows their documented "Text" shape (type + data.message) with the
// media url added the same way most WhatsApp BSPs do it. If Interakt rejects
// this shape, check Railway logs — axios logs e.response?.data below, which
// will show Interakt's validation error naming the field it actually wants.
router.post('/leads/:id/send-media', protect, adminOnly, async (req, res) => {
  try {
    const { url, caption, media_type } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const type = media_type === 'document' ? 'Document' : 'Image';

    const lead = await WhatsAppLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!INTERAKT_API_KEY) return res.status(500).json({ error: 'INTERAKT_API_KEY not configured on server' });

    await axios.post(INTERAKT_SEND_URL, {
      countryCode: '+91',
      phoneNumber: lead.phone.replace(/^91/, ''),
      type,
      data: { message: caption || '', url },
    }, {
      headers: { Authorization: `Basic ${INTERAKT_API_KEY}`, 'Content-Type': 'application/json' },
    });

    lead.last_message   = caption || (type === 'Document' ? '📄 Document' : '📷 Photo');
    lead.last_direction = 'outbound';
    lead.unread         = false;
    lead.last_msg_at    = new Date();
    await lead.save();

    await WhatsAppMessage.create({
      lead_id: lead._id, direction: 'outbound', text: caption || '',
      media_url: url, media_type: media_type === 'document' ? 'document' : 'image',
      sender: req.user?.name || 'admin', status: 'sent',
    });

    res.json({ success: true });
  } catch (e) {
    console.error('Interakt media send error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── Admin: send an approved WhatsApp template — the only thing that works
// outside the 24-hour customer-messaged window ──
// NOTE: Interakt's exact field names for template sends aren't confirmed
// from official docs (couldn't reach them). This follows the general shape
// their resource-center article describes (template name + ordered body
// variable values). If Interakt rejects this shape, Railway logs will show
// their validation error naming the field it actually wants — fix from there.
router.post('/leads/:id/send-template', protect, adminOnly, async (req, res) => {
  try {
    const { template_name, language, params } = req.body;
    if (!template_name) return res.status(400).json({ error: 'template_name is required' });

    const lead = await WhatsAppLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!INTERAKT_API_KEY) return res.status(500).json({ error: 'INTERAKT_API_KEY not configured on server' });

    const bodyValues = Array.isArray(params) ? params.filter(p => p !== '') : [];

    await axios.post(INTERAKT_SEND_URL, {
      countryCode: '+91',
      phoneNumber: lead.phone.replace(/^91/, ''),
      type: 'Template',
      template: {
        name: template_name,
        languageCode: language || 'en',
        bodyValues,
      },
    }, {
      headers: { Authorization: `Basic ${INTERAKT_API_KEY}`, 'Content-Type': 'application/json' },
    });

    const preview = `📋 Template: ${template_name}` + (bodyValues.length ? ` (${bodyValues.join(', ')})` : '');
    lead.last_message   = preview;
    lead.last_direction = 'outbound';
    lead.unread         = false;
    lead.last_msg_at    = new Date();
    await lead.save();

    await WhatsAppMessage.create({
      lead_id: lead._id, direction: 'outbound', text: preview,
      sender: req.user?.name || 'admin', status: 'sent',
    });

    res.json({ success: true });
  } catch (e) {
    console.error('Interakt template send error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── Admin: mark a lead's thread as read ─────────────────
router.post('/leads/:id/read', protect, adminOnly, async (req, res) => {
  await WhatsAppLead.findByIdAndUpdate(req.params.id, { unread: false });
  res.json({ success: true });
});

// ── Admin: update a lead's pipeline status (New/Contacted/Quoted/Converted/Lost) ──
const VALID_STATUSES = ['new', 'contacted', 'quoted', 'converted', 'lost'];
router.put('/leads/:id/status', protect, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await WhatsAppLead.findByIdAndUpdate(req.params.id, { status });
  res.json({ success: true });
});

// ── Admin: assign a lead to a team member (free text name) ──
router.put('/leads/:id/assign', protect, adminOnly, async (req, res) => {
  await WhatsAppLead.findByIdAndUpdate(req.params.id, { assigned_to: String(req.body.assigned_to || '') });
  res.json({ success: true });
});

// ── Admin: save a private note on a lead (not sent to the guest) ──
router.put('/leads/:id/notes', protect, adminOnly, async (req, res) => {
  await WhatsAppLead.findByIdAndUpdate(req.params.id, { notes: String(req.body.notes || '') });
  res.json({ success: true });
});

module.exports = router;
