const router = require('express').Router();
const crypto = require('crypto');
const axios  = require('axios');
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');
const { buildCalendar, parseCalendar } = require('../services/ical');

// Lazily ensure a property has an iCal UID (used to keep export links stable)
function getOrCreateIcalUid(propertyId) {
  const row = db.prepare('SELECT ical_uid FROM properties WHERE id = ?').get(propertyId);
  if (!row) return null;
  if (row.ical_uid) return row.ical_uid;
  const uid = crypto.randomBytes(12).toString('hex');
  db.prepare('UPDATE properties SET ical_uid = ? WHERE id = ?').run(uid, propertyId);
  return uid;
}

// GET /api/ical/export/:uid.ics  — public, served as text/calendar
router.get('/export/:uid.ics', (req, res) => {
  const prop = db.prepare('SELECT * FROM properties WHERE ical_uid = ?').get(req.params.uid);
  if (!prop) return res.status(404).type('text/plain').send('Not found');

  // Combine confirmed/pending bookings + external blocks
  const bookings = db.prepare(`
    SELECT id, checkin as start, checkout as end, guest_name FROM bookings
    WHERE property_id = ? AND status IN ('pending','confirmed','checked_in','checked_out')
  `).all(prop.id);

  const blocks = db.prepare(`
    SELECT id, start_date as start, end_date as end, summary, external_uid FROM ical_blocks
    WHERE property_id = ?
  `).all(prop.id);

  const events = [
    ...bookings.map(b => ({
      id:  `b${b.id}`,
      start: b.start,
      end:   b.end,
      summary: `Reserved — ${b.guest_name || 'Guest'} (StayDekho)`,
    })),
    ...blocks.map(x => ({
      uid:    x.external_uid || `ext-${x.id}@staydekho`,
      start:  x.start,
      end:    x.end,
      summary: x.summary || 'Blocked',
    })),
  ];

  const ics = buildCalendar({
    propertyId:   prop.id,
    propertyName: prop.name,
    hostname:     req.get('host') || 'staydekho.com',
    events,
  });
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `inline; filename="${prop.name.replace(/[^a-z0-9]+/gi,'-')}.ics"`);
  res.send(ics);
});

// Admin: get export URL + manage iCal sources for one property
// GET /api/ical/property/:id
router.get('/property/:id', protect, adminOnly, (req, res) => {
  const prop = db.prepare('SELECT id, name, ical_uid FROM properties WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const uid = getOrCreateIcalUid(prop.id);
  const host = `${req.protocol}://${req.get('host')}`;
  const sources = db.prepare('SELECT * FROM ical_sources WHERE property_id = ? ORDER BY id').all(prop.id);
  res.json({
    property_id:  prop.id,
    name:         prop.name,
    export_url:   `${host}/api/ical/export/${uid}.ics`,
    sources,
  });
});

// POST /api/ical/property/:id/sources  body: { url, label? }
router.post('/property/:id/sources', protect, adminOnly, (req, res) => {
  const { url, label } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const result = db.prepare('INSERT INTO ical_sources (property_id, url, label) VALUES (?, ?, ?)')
    .run(req.params.id, url, label || '');
  const row = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ source: row });
});

// DELETE /api/ical/sources/:sourceId
router.delete('/sources/:sourceId', protect, adminOnly, async (req, res) => {
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(req.params.sourceId);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  const { property_id } = source;

  // Remove the source
  db.prepare('DELETE FROM ical_sources WHERE id = ?').run(req.params.sourceId);

  // Clear all external blocks for this property
  db.prepare("DELETE FROM ical_blocks WHERE property_id = ? AND source = 'external'").run(property_id);

  // Re-sync remaining sources for this property so their blocks are restored
  const remaining = db.prepare('SELECT * FROM ical_sources WHERE property_id = ?').all(property_id);
  for (const src of remaining) {
    try {
      const resp = await axios.get(src.url, {
        timeout: 15000,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/calendar, text/plain, */*',
        }
      });
      const events = parseCalendar(resp.data || '');
      const upsert = db.prepare(`
        INSERT INTO ical_blocks (property_id, source, external_uid, summary, start_date, end_date, synced_at)
        VALUES (?, 'external', ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(property_id, external_uid) DO UPDATE SET
          summary=excluded.summary, start_date=excluded.start_date,
          end_date=excluded.end_date, synced_at=excluded.synced_at
      `);
      for (const ev of events) {
        if (!ev.uid || !ev.start || !ev.end) continue;
        upsert.run(property_id, ev.uid, ev.summary || '', ev.start, ev.end);
      }
      db.prepare("UPDATE ical_sources SET last_synced = datetime('now'), last_error = NULL WHERE id = ?").run(src.id);
    } catch (err) {
      const msg = err.response?.status ? `HTTP ${err.response.status}` : err.message;
      db.prepare('UPDATE ical_sources SET last_error = ? WHERE id = ?').run(msg, src.id);
    }
  }

  res.json({ message: 'Source removed and calendar re-synced' });
});

// POST /api/ical/sync  — pulls all configured iCal source URLs and stores blocks
// Optional body: { property_id } to scope to a single property
router.post('/sync', protect, adminOnly, async (req, res) => {
  const propertyId = req.body && req.body.property_id;
  const sources = propertyId
    ? db.prepare('SELECT * FROM ical_sources WHERE property_id = ?').all(propertyId)
    : db.prepare('SELECT * FROM ical_sources').all();

  let imported = 0;
  const errors = [];

  for (const src of sources) {
    try {
      // FIX: Added Extra Headers to completely mimic Google Chrome browser
      const resp = await axios.get(src.url, { 
        timeout: 30000, 
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/calendar, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
          'Connection': 'keep-alive',
          'Cache-Control': 'max-age=0',
          'Upgrade-Insecure-Requests': '1'
        }
      });
      const events = parseCalendar(resp.data || '');
      const upsert = db.prepare(`
        INSERT INTO ical_blocks (property_id, source, external_uid, summary, start_date, end_date, synced_at)
        VALUES (?, 'external', ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(property_id, external_uid) DO UPDATE SET
          summary=excluded.summary, start_date=excluded.start_date,
          end_date=excluded.end_date, synced_at=excluded.synced_at
      `);
      
      // Removed db.transaction() and used a simple loop
      for (const ev of events) {
        if (!ev.uid || !ev.start || !ev.end) continue;
        upsert.run(src.property_id, ev.uid, ev.summary || '', ev.start, ev.end);
        imported++;
      }
      
      db.prepare('UPDATE ical_sources SET last_synced = datetime(\'now\'), last_error = NULL WHERE id = ?')
        .run(src.id);
    } catch (err) {
      const msg = err.response?.status ? `HTTP ${err.response.status}` : err.message;
      db.prepare('UPDATE ical_sources SET last_error = ? WHERE id = ?').run(msg, src.id);
      errors.push({ source_id: src.id, url: src.url, error: msg });
    }
  }

  res.json({ imported, errors, sources_checked: sources.length });
});

// GET /api/ical/property/:id/blocks  — combined view (admin)
router.get('/property/:id/blocks', protect, adminOnly, (req, res) => {
  const blocks = db.prepare('SELECT * FROM ical_blocks WHERE property_id = ? ORDER BY start_date').all(req.params.id);
  res.json({ blocks });
});

// DELETE /api/ical/property/:id/blocks  — clear all external blocks for a property (admin)
router.delete('/property/:id/blocks', protect, adminOnly, (req, res) => {
  const info = db.prepare("DELETE FROM ical_blocks WHERE property_id = ? AND source = 'external'").run(req.params.id);
  res.json({ message: 'External blocks cleared', deleted: info.changes });
});

module.exports = router;