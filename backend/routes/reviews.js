const router = require('express').Router();
const db     = require('../db/database');
const { protect, optionalAuth } = require('../middleware/auth');

// GET /api/reviews?property_id=X  — public
router.get('/', (req, res) => {
  const { property_id } = req.query;
  if (!property_id) return res.status(400).json({ error: 'property_id is required' });

  const rows = db.prepare(`
    SELECT r.*, u.name as user_name
    FROM reviews r JOIN users u ON r.user_id = u.id
    WHERE r.property_id = ?
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all(Number(property_id));

  const avg = rows.length
    ? (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1)
    : null;

  res.json({ reviews: rows, avg_rating: avg, count: rows.length });
});

// POST /api/reviews  — auth required
router.post('/', protect, (req, res) => {
  const { property_id, booking_id, rating, text } = req.body;
  if (!property_id || !rating || !text)
    return res.status(400).json({ error: 'property_id, rating and text are required' });
  if (rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });

  // Check property exists
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(Number(property_id));
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  // If booking_id provided, check ownership
  if (booking_id) {
    const bk = db.prepare('SELECT id FROM bookings WHERE id = ? AND user_id = ?')
      .get(Number(booking_id), req.user.id);
    if (!bk) return res.status(403).json({ error: 'Booking not found or not yours' });
  }

  // One review per user per property
  const existing = db.prepare('SELECT id FROM reviews WHERE user_id = ? AND property_id = ?')
    .get(req.user.id, Number(property_id));
  if (existing) {
    // Update existing review
    db.prepare('UPDATE reviews SET rating=?, text=?, booking_id=? WHERE id=?')
      .run(Number(rating), String(text).trim(), booking_id || null, existing.id);
    const updated = db.prepare('SELECT r.*, u.name as user_name FROM reviews r JOIN users u ON r.user_id=u.id WHERE r.id=?').get(existing.id);
    return res.json({ review: updated, updated: true });
  }

  const result = db.prepare(
    'INSERT INTO reviews (user_id, property_id, booking_id, rating, text) VALUES (?,?,?,?,?)'
  ).run(req.user.id, Number(property_id), booking_id || null, Number(rating), String(text).trim());

  const review = db.prepare('SELECT r.*, u.name as user_name FROM reviews r JOIN users u ON r.user_id=u.id WHERE r.id=?')
    .get(result.lastInsertRowid);

  res.status(201).json({ review });
});

// DELETE /api/reviews/:id  — only own review or admin
router.delete('/:id', protect, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(req.params.id));
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (req.user.role !== 'admin' && review.user_id !== req.user.id)
    return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM reviews WHERE id = ?').run(review.id);
  res.json({ message: 'Review deleted' });
});

module.exports = router;
