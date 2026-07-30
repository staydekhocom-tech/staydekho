const router = require('express').Router();
const { SiteSetting, Property, Booking, Review } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

/* Tiny in-process cache. These two endpoints are hit on every homepage load but
   their data changes only when an admin saves settings, so a short TTL removes
   most of the database work. Cleared immediately on any settings write. */
function makeCache(ttlMs) {
  let value = null, expires = 0;
  return {
    get: () => (value && Date.now() < expires) ? value : null,
    set: v => { value = v; expires = Date.now() + ttlMs; },
    clear: () => { value = null; expires = 0; },
  };
}
const statsCache    = makeCache(60 * 1000);
const settingsCache = makeCache(60 * 1000);

async function getAllSettings() {
  const rows = await SiteSetting.find().lean();
  const out  = {};
  for (const r of rows) out[r.key] = r.value;
  // hero_slides is stored as JSON
  try { out.hero_slides = JSON.parse(out.hero_slides || '[]'); }
  catch { out.hero_slides = []; }
  // hero_slides_mobile is stored as JSON
  try { out.hero_slides_mobile = JSON.parse(out.hero_slides_mobile || '[]'); }
  catch { out.hero_slides_mobile = []; }
  return out;
}

// GET /api/site-settings  — public
router.get('/', async (_req, res) => {
  try {
    const cached = settingsCache.get();
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ settings: cached });
    }
    const settings = await getAllSettings();
    settingsCache.set(settings);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/site-settings/public-stats  — homepage hero stats
router.get('/public-stats', async (_req, res) => {
  try {
    const cached = statsCache.get();
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(cached);
    }

    // Every query runs in one round trip. Previously this ran in three sequential
    // waves (including four separate lookups against the same settings collection),
    // which is what made the homepage wait on it.
    const [villas, guestsAgg, ratingAgg, locationAgg, overrideRows] = await Promise.all([
      Property.countDocuments({ status: 'Active' }),
      Booking.aggregate([
        { $match: { status: { $in: ['confirmed', 'checked_in', 'checked_out'] } } },
        { $group: { _id: null, total: { $sum: '$guests' } } },
      ]),
      Review.aggregate([
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ]),
      Property.aggregate([
        { $match: { status: 'Active' } },
        { $group: { _id: '$location' } },
        { $count: 'total' },
      ]),
      SiteSetting.find({ key: { $in: [
        'stats_villas_override', 'stats_destinations_override',
        'stats_guests_override', 'stats_rating_override',
      ] } }).lean(),
    ]);

    const guests       = guestsAgg[0]?.total || 0;
    const rating       = ratingAgg[0]?.avg ? parseFloat(ratingAgg[0].avg.toFixed(1)) : null;
    const destinations = locationAgg[0]?.total || 0;

    const overrides = {};
    for (const r of overrideRows) overrides[r.key] = String(r.value || '').trim();
    const pick = (key, computed) => overrides[key] || computed;

    const payload = {
      stats: {
        villas:       pick('stats_villas_override',       villas > 0 ? `${villas}+` : '10+'),
        destinations: pick('stats_destinations_override', destinations > 0 ? `${destinations}+` : '5+'),
        guests:       pick('stats_guests_override',       guests >= 500 ? `${Math.floor(guests / 100) * 100}+`
                                                                       : (guests > 0 ? `${guests}+` : '500+')),
        rating:       pick('stats_rating_override',       rating ? `${rating}★` : '4.8★'),
      },
      raw: { villas, destinations, guests, rating },
    };

    statsCache.set(payload);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/site-settings  — admin bulk update  body: { settings: { key: value, ... } }
router.put('/', protect, adminOnly, async (req, res) => {
  const incoming = req.body && req.body.settings;
  if (!incoming || typeof incoming !== 'object')
    return res.status(400).json({ error: 'settings object required' });

  try {
    const ops = Object.entries(incoming).map(([k, v]) => {
      const val = Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
      return SiteSetting.findOneAndUpdate({ key: k }, { key: k, value: val }, { upsert: true });
    });
    await Promise.all(ops);

    // Serve the new values right away rather than waiting for the TTL
    settingsCache.clear();
    statsCache.clear();

    const settings = await getAllSettings();
    settingsCache.set(settings);
    res.json({ settings });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ error: 'Error saving settings' });
  }
});

module.exports = router;
