const router = require('express').Router();
const crypto = require('crypto');
const axios  = require('axios');
const { Property, Booking, IcalBlock, IcalSource } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');
const { buildCalendar, parseCalendar } = require('../services/ical');

// Lazily ensure a property has an iCal UID
async function getOrCreateIcalUid(propertyId) {
  const prop = await Property.findById(propertyId).select('ical_uid').lean();
  if (!prop) return null;
  if (prop.ical_uid) return prop.ical_uid;
  const uid = crypto.randomBytes(12).toString('hex');
  await Property.findByIdAndUpdate(propertyId, { ical_uid: uid });
  return uid;
}

// GET /api/ical/export/:uid.ics  — public, served as text/calendar
router.get('/export/:uid.ics', async (req, res) => {
  try {
    const prop = await Property.findOne({ ical_uid: req.params.uid }).lean();
    if (!prop) return res.status(404).type('text/plain').send('Not found');

    const bookings = await Booking.find({
      property_id: prop._id,
      status: { $in: ['pending','confirmed','checked_in','checked_out'] },
    }).select('checkin checkout guest_name').lean();

    const blocks = await IcalBlock.find({ property_id: prop._id }).lean();

    const events = [
      ...bookings.map(b => ({
        id:      `b${b._id}`,
        start:   b.checkin,
        end:     b.checkout,
        summary: `Reserved — ${b.guest_name || 'Guest'} (StayDekho)`,
      })),
      ...blocks.map(x => ({
        uid:     x.external_uid || `ext-${x._id}@staydekho`,
        start:   x.start_date,
        end:     x.end_date,
        summary: x.summary || 'Blocked',
      })),
    ];

    const ics = buildCalendar({
      propertyId:   prop._id.toString(),
      propertyName: prop.name,
      hostname:     req.get('host') || 'staydekho.com',
      events,
    });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="${prop.name.replace(/[^a-z0-9]+/gi,'-')}.ics"`);
    res.send(ics);
  } catch (err) {
    res.status(500).type('text/plain').send(err.message);
  }
});

// GET /api/ical/property/:id  — admin: get export URL + sources
router.get('/property/:id', protect, adminOnly, async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id).select('name ical_uid').lean();
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    const uid = await getOrCreateIcalUid(prop._id);
    const host = `${req.protocol}://${req.get('host')}`;
    const sources = await IcalSource.find({ property_id: prop._id }).lean();
    res.json({
      property_id:  prop._id,
      name:         prop.name,
      export_url:   `${host}/api/ical/export/${uid}.ics`,
      sources,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ical/property/:id/sources  body: { url, label? }
router.post('/property/:id/sources', protect, adminOnly, async (req, res) => {
  const { url, label } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const source = await IcalSource.create({ property_id: req.params.id, url, label: label || '' });
    res.status(201).json({ source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ical/sources/:sourceId
router.delete('/sources/:sourceId', protect, adminOnly, async (req, res) => {
  try {
    const source = await IcalSource.findById(req.params.sourceId).lean();
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const { property_id } = source;
    await IcalSource.findByIdAndDelete(req.params.sourceId);
    await IcalBlock.deleteMany({ property_id, source: 'external' });

    const remaining = await IcalSource.find({ property_id }).lean();
    for (const src of remaining) {
      try {
        const resp = await axios.get(src.url, {
          timeout: 15000, responseType: 'text',
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/calendar, */*' },
        });
        const events = parseCalendar(resp.data || '');
        for (const ev of events) {
          if (!ev.uid || !ev.start || !ev.end) continue;
          await IcalBlock.findOneAndUpdate(
            { property_id, external_uid: ev.uid },
            { source: 'external', summary: ev.summary || '', start_date: ev.start, end_date: ev.end, synced_at: new Date() },
            { upsert: true }
          );
        }
        await IcalSource.findByIdAndUpdate(src._id, { last_synced: new Date(), last_error: null });
      } catch (err) {
        const msg = err.response?.status ? `HTTP ${err.response.status}` : err.message;
        await IcalSource.findByIdAndUpdate(src._id, { last_error: msg });
      }
    }
    res.json({ message: 'Source removed and calendar re-synced' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ical/sync  — pulls all iCal source URLs and stores blocks
router.post('/sync', protect, adminOnly, async (req, res) => {
  try {
    const propertyId = req.body && req.body.property_id;
    const query = propertyId ? { property_id: propertyId } : {};
    const sources = await IcalSource.find(query).lean();

    let imported = 0;
    const errors = [];

    for (const src of sources) {
      try {
        const resp = await axios.get(src.url, {
          timeout: 30000, responseType: 'text',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/calendar, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
          },
        });
        const events = parseCalendar(resp.data || '');
        for (const ev of events) {
          if (!ev.uid || !ev.start || !ev.end) continue;
          await IcalBlock.findOneAndUpdate(
            { property_id: src.property_id, external_uid: ev.uid },
            { source: 'external', summary: ev.summary || '', start_date: ev.start, end_date: ev.end, synced_at: new Date() },
            { upsert: true }
          );
          imported++;
        }
        await IcalSource.findByIdAndUpdate(src._id, { last_synced: new Date(), last_error: null });
      } catch (err) {
        const msg = err.response?.status ? `HTTP ${err.response.status}` : err.message;
        await IcalSource.findByIdAndUpdate(src._id, { last_error: msg });
        errors.push({ source_id: src._id, url: src.url, error: msg });
      }
    }
    res.json({ imported, errors, sources_checked: sources.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ical/property/:id/blocks  — combined view (admin)
router.get('/property/:id/blocks', protect, adminOnly, async (req, res) => {
  try {
    const blocks = await IcalBlock.find({ property_id: req.params.id }).sort({ start_date: 1 }).lean();
    res.json({ blocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ical/property/:id/blocks  — clear all external blocks (admin)
router.delete('/property/:id/blocks', protect, adminOnly, async (req, res) => {
  try {
    const result = await IcalBlock.deleteMany({ property_id: req.params.id, source: 'external' });
    res.json({ message: 'External blocks cleared', deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
