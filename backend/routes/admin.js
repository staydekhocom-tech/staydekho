const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const totalProperties = db.prepare("SELECT COUNT(*) as c FROM properties").get().c;
  const activeProperties = db.prepare("SELECT COUNT(*) as c FROM properties WHERE status='Active'").get().c;
  const totalBookings   = db.prepare("SELECT COUNT(*) as c FROM bookings").get().c;
  const confirmedBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='confirmed'").get().c;
  const pendingBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='pending'").get().c;
  const cancelledBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='cancelled'").get().c;
  const activeBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status IN ('confirmed','checked_in')").get().c;
  const totalUsers      = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='user'").get().c;
  const totalRevenue    = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM bookings WHERE status='confirmed'").get().s;
  const monthRevenue    = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as s FROM bookings
    WHERE status='confirmed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')
  `).get().s;

  const recentBookings = db.prepare(`
    SELECT b.*, u.name as user_name, p.name as property_name
    FROM bookings b JOIN users u ON b.user_id=u.id JOIN properties p ON b.property_id=p.id
    ORDER BY b.created_at DESC LIMIT 10
  `).all();

  const monthlyRevenue = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as revenue, COUNT(*) as bookings
    FROM bookings WHERE status='confirmed'
    GROUP BY month ORDER BY month DESC LIMIT 6
  `).all();

  res.json({
    stats: { totalProperties, activeProperties, totalBookings, confirmedBookings, pendingBookings,
             cancelledBookings, activeBookings, totalUsers, totalRevenue, monthRevenue },
    recentBookings,
    monthlyRevenue,
  });
});

// GET /api/admin/today  — today's check-ins and check-outs
router.get('/today', (_req, res) => {
  const checkins = db.prepare(`
    SELECT b.id, b.guest_name, b.guest_phone, b.checkin, b.checkout, b.guests, b.status,
           p.id as property_id, p.name as property_name, p.location as property_location
    FROM bookings b JOIN properties p ON b.property_id = p.id
    WHERE b.checkin = date('now') AND b.status IN ('pending','confirmed','checked_in')
    ORDER BY p.name
  `).all();
  const checkouts = db.prepare(`
    SELECT b.id, b.guest_name, b.guest_phone, b.checkin, b.checkout, b.guests, b.status,
           p.id as property_id, p.name as property_name, p.location as property_location
    FROM bookings b JOIN properties p ON b.property_id = p.id
    WHERE b.checkout = date('now') AND b.status IN ('confirmed','checked_in','checked_out')
    ORDER BY p.name
  `).all();
  res.json({ date: new Date().toISOString().slice(0,10), checkins, checkouts });
});

// GET /api/admin/bookings  — filterable list (status, from, to)
router.get('/bookings', (req, res) => {
  const { status, from, to } = req.query;
  let sql = `SELECT b.*, u.name as user_name, p.name as property_name
             FROM bookings b
             JOIN users u ON b.user_id = u.id
             JOIN properties p ON b.property_id = p.id
             WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND b.status = ?'; args.push(status); }
  if (from)   { sql += ' AND b.checkin >= ?'; args.push(from); }
  if (to)     { sql += ' AND b.checkin <= ?'; args.push(to); }
  sql += ' ORDER BY b.created_at DESC';
  res.json({ bookings: db.prepare(sql).all(...args) });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
           COUNT(b.id) as booking_count
    FROM users u LEFT JOIN bookings b ON b.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  res.json({ users });
});

// GET /api/admin/reviews — all reviews with user + property info
router.get('/reviews', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.name as user_name, p.name as property_name
    FROM reviews r
    JOIN users u ON r.user_id = u.id
    JOIN properties p ON r.property_id = p.id
    ORDER BY r.created_at DESC
  `).all();
  res.json({ reviews: rows });
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role))
    return res.status(400).json({ error: 'Role must be user or admin' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ message: 'User deleted' });
});

module.exports = router;
