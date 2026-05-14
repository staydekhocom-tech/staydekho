const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

// Map DB row → frontend-friendly shape
function normalize(p) {
  const raw = JSON.parse(p.images || '[]');
  // Support both legacy string[] and new {url,cat}[] formats
  const categorized_images = raw.map(img =>
    typeof img === 'string' ? { url: img, cat: 'Exterior' } : img
  );
  const images = categorized_images.map(i => i.url);

  const amenities = p.amenities
    ? p.amenities.split(',').map(a => a.trim()).filter(Boolean)
    : [];
  const rules  = JSON.parse(p.rules  || '[]');
  const addons = JSON.parse(p.addons || '[]');

  return {
    ...p,
    title:         p.name,
    main_image:    images[0] || null,
    images,
    categorized_images,
    baths:         p.bathrooms,
    max_guests:    p.guests,
    amenities,
    rules,
    addons,
    map_url:       p.map_url      || '',
    brochure_url:  p.brochure_url || '',
    fomo_enabled:  p.fomo_enabled !== 0,
    fomo_bookings: p.fomo_bookings,
    fomo_viewers:  p.fomo_viewers,
    checkin_time:  p.checkin_time  || '2:00 PM',
    checkout_time: p.checkout_time || '11:00 AM',
    rating:        null,
    review_count:  0,
    badge:         null,
    wishlisted:    false,
  };
}

// GET /api/properties  — public (admin sees all, guests see only Active)
router.get('/', optionalAuth, (req, res) => {
  const { location, q, minPrice, maxPrice, guests, status } = req.query;
  const search = location || q;   // accept both
  let sql    = `
    SELECT p.*,
      (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.property_id = p.id) as avg_rating,
      (SELECT COUNT(r.id) FROM reviews r WHERE r.property_id = p.id) as review_count
    FROM properties p WHERE 1=1`;
  const args = [];

  if (status)   { sql += ' AND p.status = ?';           args.push(status); }
  else if (!req.user || req.user.role !== 'admin') { sql += " AND p.status = 'Active'"; }
  if (search)   { sql += ' AND (p.location LIKE ? OR p.name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  if (guests)   { sql += ' AND p.guests >= ?';           args.push(Number(guests)); }
  if (minPrice) { sql += ' AND p.price >= ?';            args.push(Number(minPrice)); }
  if (maxPrice) { sql += ' AND p.price <= ?';            args.push(Number(maxPrice)); }

  sql += ' ORDER BY p.created_at DESC';

  const today = new Date().toISOString().split('T')[0];
  const getTodayPrice = db.prepare(
    "SELECT price FROM date_prices WHERE property_id = ? AND date = ? AND blocked = 0 AND price IS NOT NULL"
  );

  const rows = db.prepare(sql).all(...args).map(p => {
    const norm = normalize(p);
    norm.rating       = p.avg_rating ? String(p.avg_rating) : null;
    norm.review_count = p.review_count || 0;
    const dp = getTodayPrice.get(p.id, today);
    norm.today_price  = dp ? dp.price : null;
    return norm;
  });
  res.json({ properties: rows });
});

// GET /api/properties/:id  — public
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Property not found' });

  const host = db.prepare("SELECT id, name, email, created_at FROM users WHERE role='admin' LIMIT 1").get() || {};

  // Fetch real reviews
  const reviews = db.prepare(`
    SELECT r.*, u.name as user_name FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.property_id = ? ORDER BY r.created_at DESC LIMIT 20
  `).all(row.id);

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  const prop = normalize(row);
  prop.rating       = avgRating;
  prop.review_count = reviews.length;

  res.json({ property: prop, host, reviews });
});

// GET /api/properties/:id/availability  — public, returns booked date ranges
router.get('/:id/availability', (req, res) => {
  const { id } = req.params;
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const booked = db.prepare(`
    SELECT checkin, checkout FROM bookings
    WHERE property_id = ? AND status IN ('pending','confirmed','checked_in')
    AND checkout >= date('now')
  `).all(id);

  res.json({ booked });
});

// POST /api/properties  — admin only
router.post('/', protect, adminOnly, (req, res) => {
  const { name, location, price, guests, beds, bathrooms, description, amenities, images, status,
          map_url, brochure_url, rules, addons, checkin_time, checkout_time,
          fomo_bookings, fomo_viewers, fomo_enabled } = req.body;
  if (!name || !location || !price)
    return res.status(400).json({ error: 'Name, location and price are required' });

  const result = db.prepare(`
    INSERT INTO properties (name, location, price, guests, beds, bathrooms, description, amenities, images, status,
      map_url, brochure_url, rules, addons, checkin_time, checkout_time,
      fomo_bookings, fomo_viewers, fomo_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, location, price, guests||10, beds||4, bathrooms||3, description||'', amenities||'',
         JSON.stringify(images||[]), status||'Active',
         map_url || '', brochure_url || '',
         JSON.stringify(rules || []), JSON.stringify(addons || []),
         checkin_time || '2:00 PM', checkout_time || '11:00 AM',
         fomo_bookings ?? null, fomo_viewers ?? null,
         fomo_enabled === false ? 0 : 1);

  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ property: normalize(prop) });
});

// PUT /api/properties/:id  — admin only
router.put('/:id', protect, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found' });

  const { name, location, price, guests, beds, bathrooms, description, amenities, images, status,
          checkin_time, checkout_time, rules, addons, map_url, brochure_url,
          fomo_bookings, fomo_viewers, fomo_enabled } = req.body;
  db.prepare(`
    UPDATE properties SET name=?, location=?, price=?, guests=?, beds=?, bathrooms=?,
      description=?, amenities=?, images=?, status=?, checkin_time=?, checkout_time=?, rules=?,
      addons=?, map_url=?, brochure_url=?, fomo_bookings=?, fomo_viewers=?, fomo_enabled=?
    WHERE id=?
  `).run(
    name         || existing.name,
    location     || existing.location,
    price        || existing.price,
    guests       || existing.guests,
    beds         || existing.beds,
    bathrooms    || existing.bathrooms,
    description  ?? existing.description,
    amenities    ?? existing.amenities,
    images       ? JSON.stringify(images) : existing.images,
    status       || existing.status,
    checkin_time  ?? existing.checkin_time  ?? '2:00 PM',
    checkout_time ?? existing.checkout_time ?? '11:00 AM',
    rules  !== undefined ? JSON.stringify(rules  || []) : (existing.rules  || '[]'),
    addons !== undefined ? JSON.stringify(addons || []) : (existing.addons || '[]'),
    map_url      ?? existing.map_url      ?? '',
    brochure_url ?? existing.brochure_url ?? '',
    fomo_bookings !== undefined ? fomo_bookings : existing.fomo_bookings,
    fomo_viewers  !== undefined ? fomo_viewers  : existing.fomo_viewers,
    fomo_enabled === undefined ? (existing.fomo_enabled ?? 1) : (fomo_enabled ? 1 : 0),
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  res.json({ property: normalize(updated) });
});

// GET /api/properties/:id/date-prices  — public
router.get('/:id/date-prices', (req, res) => {
  const rows = db.prepare(
    'SELECT date, price, blocked, note FROM date_prices WHERE property_id = ? ORDER BY date'
  ).all(req.params.id);
  res.json({ date_prices: rows });
});

// POST /api/properties/:id/date-prices  — admin: bulk upsert
// body: { prices: [{ date, price, blocked, note }] }
router.post('/:id/date-prices', protect, adminOnly, (req, res) => {
  const { prices } = req.body;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'prices array required' });

  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const upsert = db.prepare(`
    INSERT INTO date_prices (property_id, date, price, blocked, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(property_id, date) DO UPDATE SET
      price = excluded.price, blocked = excluded.blocked, note = excluded.note
  `);
  const del = db.prepare('DELETE FROM date_prices WHERE property_id = ? AND date = ?');

  db.exec('BEGIN');
  try {
    for (const r of prices) {
      if (!r.date) continue;
      if (!r.blocked && !r.price) {
        del.run(req.params.id, r.date);
      } else {
        upsert.run(req.params.id, r.date, r.price || null, r.blocked ? 1 : 0, r.note || '');
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const updated = db.prepare(
    'SELECT date, price, blocked, note FROM date_prices WHERE property_id = ? ORDER BY date'
  ).all(req.params.id);
  res.json({ date_prices: updated });
});

// DELETE /api/properties/:id  — admin only
router.delete('/:id', protect, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found' });
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  res.json({ message: 'Property deleted' });
});

module.exports = router;
