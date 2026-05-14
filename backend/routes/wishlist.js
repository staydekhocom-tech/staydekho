const router = require('express').Router();
const db = require('../db/database');
const { protect } = require('../middleware/auth');

// GET /api/wishlist — user ki wishlist
router.get('/', protect, (req, res) => {
  const rows = db.prepare(
    `SELECT p.* FROM wishlists w
     JOIN properties p ON p.id = w.property_id
     WHERE w.user_id = ?
     ORDER BY w.created_at DESC`
  ).all(req.user.id);
  res.json({ properties: rows });
});

// GET /api/wishlist/ids — sirf IDs (quick check ke liye)
router.get('/ids', protect, (req, res) => {
  const rows = db.prepare('SELECT property_id FROM wishlists WHERE user_id = ?').all(req.user.id);
  res.json({ ids: rows.map(r => r.property_id) });
});

// POST /api/wishlist/:id — add
router.post('/:id', protect, (req, res) => {
  const propertyId = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM wishlists WHERE user_id = ? AND property_id = ?').get(req.user.id, propertyId);
  if (!exists) {
    db.prepare('INSERT INTO wishlists (user_id, property_id) VALUES (?, ?)').run(req.user.id, propertyId);
  }
  res.json({ wishlisted: true });
});

// DELETE /api/wishlist/:id — remove
router.delete('/:id', protect, (req, res) => {
  db.prepare('DELETE FROM wishlists WHERE user_id = ? AND property_id = ?').run(req.user.id, Number(req.params.id));
  res.json({ wishlisted: false });
});

module.exports = router;
