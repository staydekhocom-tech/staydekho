const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  // hero_slides is stored as JSON
  try { out.hero_slides = JSON.parse(out.hero_slides || '[]'); }
  catch { out.hero_slides = []; }
  return out;
}

function pickStatOverride(key, computed) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  const override = row && row.value ? String(row.value).trim() : '';
  return override || computed;
}

// GET /api/site-settings  — public
router.get('/', (_req, res) => {
  res.json({ settings: getAllSettings() });
});

// GET /api/site-settings/public-stats  — homepage hero stats
router.get('/public-stats', (_req, res) => {
  const villas        = db.prepare("SELECT COUNT(*) as c FROM properties WHERE status='Active'").get().c;
  const destinations  = db.prepare(
    "SELECT COUNT(DISTINCT trim(substr(location, 1, instr(location,',') - 1))) as c FROM properties WHERE status='Active' AND instr(location,',') > 0"
  ).get().c || db.prepare("SELECT COUNT(DISTINCT location) as c FROM properties WHERE status='Active'").get().c;
  const guests = db.prepare("SELECT COALESCE(SUM(guests),0) as s FROM bookings WHERE status IN ('confirmed','checked_in','checked_out')").get().s;
  const rating = db.prepare('SELECT ROUND(AVG(rating),1) as r FROM reviews').get().r;

  const villasOut = pickStatOverride('stats_villas_override',
    villas > 0 ? `${villas}+` : '10+');
  const destOut = pickStatOverride('stats_destinations_override',
    destinations > 0 ? `${destinations}+` : '5+');
  const guestsOut = pickStatOverride('stats_guests_override',
    guests >= 500 ? `${Math.floor(guests/100)*100}+` : (guests > 0 ? `${guests}+` : '500+'));
  const ratingOut = pickStatOverride('stats_rating_override',
    rating ? `${rating}★` : '4.8★');

  res.json({
    stats: {
      villas:       villasOut,
      destinations: destOut,
      guests:       guestsOut,
      rating:       ratingOut,
    },
    raw: { villas, destinations, guests, rating },
  });
});

// PUT /api/site-settings  — admin bulk update  body: { settings: { key: value, ... } }
router.put('/', protect, adminOnly, (req, res) => {
  const incoming = req.body && req.body.settings;
  if (!incoming || typeof incoming !== 'object')
    return res.status(400).json({ error: 'settings object required' });

  try {
    const upsert = db.prepare(`
      INSERT INTO site_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    // Direct execution loop instead of transaction wrapper
    for (const [k, v] of Object.entries(incoming)) {
      const val = Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
      upsert.run(k, val);
    }

    res.json({ settings: getAllSettings() });
  } catch (error) {
    console.error("Settings save error:", error);
    res.status(500).json({ error: 'Error saving settings' });
  }
});

module.exports = router;