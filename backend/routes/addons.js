const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/addons/mine  — current user's addon requests + addons attached to their bookings
router.get('/mine', protect, (req, res) => {
  const requests = db.prepare(`
    SELECT a.*, b.checkin, b.checkout, p.name as property_name FROM addon_requests a
    LEFT JOIN bookings b ON a.booking_id = b.id
    LEFT JOIN properties p ON b.property_id = p.id
    WHERE a.user_id = ? ORDER BY a.created_at DESC
  `).all(req.user.id);
  res.json({ requests });
});

// POST /api/addons  body: { booking_id, addon, note }
router.post('/', protect, (req, res) => {
  const { booking_id, addon, note } = req.body;
  if (!addon) return res.status(400).json({ error: 'addon required' });

  // If booking_id given, must belong to current user
  if (booking_id) {
    const own = db.prepare('SELECT id FROM bookings WHERE id = ? AND user_id = ?').get(booking_id, req.user.id);
    if (!own) return res.status(403).json({ error: 'Booking not yours' });
  }

  const result = db.prepare(`
    INSERT INTO addon_requests (user_id, booking_id, addon, note) VALUES (?, ?, ?, ?)
  `).run(req.user.id, booking_id || null, addon, note || '');
  res.status(201).json({ request: db.prepare('SELECT * FROM addon_requests WHERE id = ?').get(result.lastInsertRowid) });
});

// GET /api/addons  — admin only
router.get('/', protect, adminOnly, (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name as user_name, u.phone as user_phone, p.name as property_name
    FROM addon_requests a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN bookings b ON a.booking_id = b.id
    LEFT JOIN properties p ON b.property_id = p.id
    ORDER BY a.created_at DESC
  `).all();
  res.json({ requests: rows });
});

// PUT /api/addons/:id/status  — admin
router.put('/:id/status', protect, adminOnly, (req, res) => {
  const { status } = req.body;
  if (!['pending','approved','rejected','fulfilled'].includes(status))
    return res.status(400).json({ error: 'invalid status' });
  db.prepare('UPDATE addon_requests SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: 'Updated' });
});

module.exports = router;
