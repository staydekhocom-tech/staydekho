const router = require('express').Router();
const { SiteSetting, Property, Booking, Review } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

async function getAllSettings() {
  const rows = await SiteSetting.find().lean();
  const out  = {};
  for (const r of rows) out[r.key] = r.value;
  // hero_slides is stored as JSON
  try { out.hero_slides = JSON.parse(out.hero_slides || '[]'); }
  catch { out.hero_slides = []; }
  return out;
}

async function pickStatOverride(key, computed) {
  const row = await SiteSetting.findOne({ key }).lean();
  const override = row && row.value ? String(row.value).trim() : '';
  return override || computed;
}

// GET /api/site-settings  — public
router.get('/', async (_req, res) => {
  try {
    const settings = await getAllSettings();
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/site-settings/public-stats  — homepage hero stats
router.get('/public-stats', async (_req, res) => {
  try {
    const [villas, guestsAgg, ratingAgg] = await Promise.all([
      Property.countDocuments({ status: 'Active' }),
      Booking.aggregate([
        { $match: { status: { $in: ['confirmed', 'checked_in', 'checked_out'] } } },
        { $group: { _id: null, total: { $sum: '$guests' } } },
      ]),
      Review.aggregate([
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ]),
    ]);

    const guests = guestsAgg[0]?.total || 0;
    const rating = ratingAgg[0]?.avg ? parseFloat(ratingAgg[0].avg.toFixed(1)) : null;

    // Distinct destinations — count distinct locations
    const locationAgg = await Property.aggregate([
      { $match: { status: 'Active' } },
      { $group: { _id: '$location' } },
      { $count: 'total' },
    ]);
    const destinations = locationAgg[0]?.total || 0;

    const [villasOut, destOut, guestsOut, ratingOut] = await Promise.all([
      pickStatOverride('stats_villas_override',       villas > 0       ? `${villas}+`                                : '10+'),
      pickStatOverride('stats_destinations_override', destinations > 0 ? `${destinations}+`                          : '5+'),
      pickStatOverride('stats_guests_override',       guests >= 500    ? `${Math.floor(guests / 100) * 100}+`
                                                                       : (guests > 0 ? `${guests}+` : '500+')),
      pickStatOverride('stats_rating_override',       rating           ? `${rating}★`                               : '4.8★'),
    ]);

    res.json({
      stats: { villas: villasOut, destinations: destOut, guests: guestsOut, rating: ratingOut },
      raw:   { villas, destinations, guests, rating },
    });
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

    const settings = await getAllSettings();
    res.json({ settings });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ error: 'Error saving settings' });
  }
});

module.exports = router;
