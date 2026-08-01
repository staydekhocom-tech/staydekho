const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const mongoose = require('mongoose');
const { Staff, StaffTask, CheckinToken, PropertySOP, StaffIssue, Booking, Property } = require('../db/models');
const { protect, adminOnly, staffProtect } = require('../middleware/auth');
const { notifyGuestRoomReady, notifyAdminGuestSigned, notifyAdminIssue } = require('../services/notify');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://staydekho.com';
const ADMIN_PHONE  = process.env.ADMIN_PHONE || '';

function staffToken(id) {
  return jwt.sign({ id, type: 'staff' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ── POST /api/staff/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN required' });

    const clean = String(phone).replace(/\D/g, '').slice(-10);
    const staff = await Staff.findOne({ phone: clean }).populate('property_id', 'name location images').lean();

    if (!staff) return res.status(401).json({ error: 'Incorrect phone or PIN' });

    // Support both bcrypt-hashed PINs and legacy plaintext (auto-upgrade on login)
    const isBcrypt = staff.pin?.startsWith('$2');
    const pinMatch = isBcrypt
      ? bcrypt.compareSync(String(pin), staff.pin)
      : staff.pin === String(pin);
    if (!pinMatch)
      return res.status(401).json({ error: 'Incorrect phone or PIN' });
    // Auto-upgrade plaintext PIN to bcrypt hash
    if (!isBcrypt) {
      Staff.findByIdAndUpdate(staff._id, { pin: bcrypt.hashSync(String(pin), 10) }).catch(() => {});
    }

    if (staff.status !== 'active')
      return res.status(403).json({ error: 'Account deactivated. Contact admin.' });

    res.json({
      token: staffToken(staff._id),
      staff: {
        id:       staff._id.toString(),
        name:     staff.name,
        phone:    staff.phone,
        role:     staff.role,
        property: staff.property_id || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/staff/dashboard ──────────────────────────────
router.get('/dashboard', staffProtect, async (req, res) => {
  try {
    const propId   = req.staff.property_id ? new mongoose.Types.ObjectId(req.staff.property_id) : null;
    const todayStr = today();

    if (!propId) return res.json({ checkins: [], checkouts: [], upcoming: [], tasks: [], issues: [] });

    const [checkins, checkouts, upcoming, tasks, issues] = await Promise.all([
      Booking.find({ property_id: propId, checkin: todayStr, status: 'confirmed' })
        .select('guest_name guest_phone checkin checkout guests status').lean(),
      Booking.find({ property_id: propId, checkout: todayStr, status: { $in: ['confirmed', 'checked_in'] } })
        .select('guest_name guest_phone checkin checkout guests status').lean(),
      Booking.find({ property_id: propId, checkin: { $gt: todayStr }, status: 'confirmed' })
        .select('guest_name checkin checkout guests').sort({ checkin: 1 }).limit(5).lean(),
      StaffTask.find({ property_id: propId, status: { $ne: 'done' }, due_date: { $gte: todayStr } })
        .sort({ due_date: 1 }).limit(10).lean(),
      StaffIssue.find({ property_id: propId, status: 'open' })
        .sort({ created_at: -1 }).limit(5).lean(),
    ]);

    res.json({
      checkins:  checkins.map(b => ({ ...b, id: b._id.toString() })),
      checkouts: checkouts.map(b => ({ ...b, id: b._id.toString() })),
      upcoming:  upcoming.map(b => ({ ...b, id: b._id.toString() })),
      tasks:     tasks.map(t => ({ ...t, id: t._id.toString() })),
      issues:    issues.map(i => ({ ...i, id: i._id.toString() })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/staff/tasks ──────────────────────────────────
router.get('/tasks', staffProtect, async (req, res) => {
  try {
    const propId = req.staff.property_id ? new mongoose.Types.ObjectId(req.staff.property_id) : null;
    if (!propId) return res.json({ tasks: [] });

    const tasks = await StaffTask.find({ property_id: propId, status: { $ne: 'done' } })
      .populate('booking_id', 'guest_name checkin checkout')
      .sort({ due_date: 1 }).lean();

    res.json({ tasks: tasks.map(t => ({
      ...t,
      id:         t._id.toString(),
      guest_name: t.booking_id?.guest_name,
      checkin:    t.booking_id?.checkin,
      checkout:   t.booking_id?.checkout,
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/staff/tasks/:id/done ────────────────────────
router.put('/tasks/:id/done', staffProtect, async (req, res) => {
  try {
    const propId = req.staff.property_id;
    const task = await StaffTask.findOne({ _id: req.params.id, property_id: propId });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const { notes, photos } = req.body;
    task.status       = 'done';
    task.notes        = notes || task.notes;
    task.photos       = JSON.stringify(photos || []);
    task.completed_at = new Date();
    await task.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/staff/room-ready ────────────────────────────
router.post('/room-ready', staffProtect, async (req, res) => {
  try {
    const { booking_id, photos } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

    const propId = req.staff.property_id;
    const booking = await Booking.findOne({
      _id: booking_id,
      property_id: propId,
      status: { $in: ['confirmed', 'pending'] },
    }).populate('property_id', 'name').lean();

    if (!booking) return res.status(404).json({ error: 'Booking not found or not confirmed' });

    const token = crypto.randomBytes(16).toString('hex');
    const photosStr = JSON.stringify(photos || []);

    await CheckinToken.findOneAndUpdate(
      { booking_id },
      { property_id: propId, token, room_photos: photosStr, ready_at: new Date(), ready_by_staff_id: req.staff.id },
      { upsert: true, new: true }
    );

    const row = await CheckinToken.findOne({ booking_id }).lean();
    const checkinLink = `${FRONTEND_URL}/checkin.html?token=${row.token}`;

    if (booking.guest_phone) {
      notifyGuestRoomReady(booking.guest_phone, booking.guest_name, checkinLink);
    }

    await StaffTask.updateMany(
      { booking_id, task_type: 'cleaning', status: { $ne: 'done' } },
      { status: 'done', completed_at: new Date() }
    );

    res.json({ success: true, checkin_link: checkinLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/staff/sop ────────────────────────────────────
router.get('/sop', staffProtect, async (req, res) => {
  try {
    const sop = await PropertySOP.findOne({ property_id: req.staff.property_id }).lean();
    res.json({ sop_photo: sop?.sop_photo || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/staff/issues ────────────────────────────────
router.post('/issues', staffProtect, async (req, res) => {
  try {
    const { title, description, photos } = req.body;
    if (!title) return res.status(400).json({ error: 'Issue title required' });

    const issue = await StaffIssue.create({
      staff_id:    req.staff.id,
      property_id: req.staff.property_id,
      title,
      description: description || '',
      photos:      JSON.stringify(photos || []),
    });

    const prop = await Property.findById(req.staff.property_id).select('name').lean();
    notifyAdminIssue(ADMIN_PHONE, req.staff.name, prop?.name || 'Property', title);

    res.json({ success: true, id: issue._id.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: manage staff ───────────────────────────────────

router.get('/all', protect, adminOnly, async (req, res) => {
  try {
    const staff = await Staff.find()
      .populate('property_id', 'name')
      .sort({ created_at: -1 }).lean();
    res.json({ staff: staff.map(s => {
      const { pin: _pin, ...safe } = s;
      return { ...safe, id: s._id.toString(), property_name: s.property_id?.name };
    }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', protect, adminOnly, async (req, res) => {
  try {
    const { name, phone, property_id, role, pin } = req.body;
    if (!name || !phone || !pin) return res.status(400).json({ error: 'Name, phone and PIN required' });

    const clean = String(phone).replace(/\D/g, '').slice(-10);
    if (clean.length < 10) return res.status(400).json({ error: 'Enter valid 10-digit phone' });
    if (String(pin).length !== 4 || !/^\d{4}$/.test(String(pin)))
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

    const staff = await Staff.create({
      name, phone: clean,
      property_id: property_id || null,
      role: role || 'caretaker',
      pin: bcrypt.hashSync(String(pin), 10),
    });
    res.json({ success: true, id: staff._id.toString() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Phone already registered' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/update/:id', protect, adminOnly, async (req, res) => {
  try {
    const { name, phone, property_id, role, pin, status } = req.body;
    const s = await Staff.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Staff not found' });

    if (name)        s.name        = name;
    if (phone)       s.phone       = String(phone).replace(/\D/g, '').slice(-10);
    if (property_id !== undefined) s.property_id = property_id || null;
    if (role)        s.role        = role;
    if (pin) {
      if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
      s.pin = bcrypt.hashSync(String(pin), 10);
    }
    if (status)      s.status      = status;
    await s.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/delete/:id', protect, adminOnly, async (req, res) => {
  try {
    await Staff.findByIdAndUpdate(req.params.id, { status: 'inactive' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: tasks management ───────────────────────────────

router.post('/tasks/create', protect, adminOnly, async (req, res) => {
  try {
    const { staff_id, property_id, booking_id, task_type, title, due_date } = req.body;
    if (!property_id || !title || !due_date) return res.status(400).json({ error: 'property_id, title and due_date required' });

    const task = await StaffTask.create({
      staff_id:    staff_id || null,
      property_id,
      booking_id:  booking_id || null,
      task_type:   task_type || 'cleaning',
      title,
      due_date,
    });
    res.json({ success: true, id: task._id.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks/all', protect, adminOnly, async (req, res) => {
  try {
    const filter = {};
    if (req.query.property_id) filter.property_id = req.query.property_id;
    if (req.query.status)      filter.status       = req.query.status;

    const tasks = await StaffTask.find(filter)
      .populate('staff_id', 'name')
      .populate('property_id', 'name')
      .populate('booking_id', 'guest_name')
      .sort({ due_date: -1 }).limit(100).lean();

    res.json({ tasks: tasks.map(t => ({
      ...t,
      id:            t._id.toString(),
      staff_name:    t.staff_id?.name,
      property_name: t.property_id?.name,
      guest_name:    t.booking_id?.guest_name,
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/issues/all', protect, adminOnly, async (req, res) => {
  try {
    const issues = await StaffIssue.find()
      .populate('staff_id', 'name')
      .populate('property_id', 'name')
      .sort({ created_at: -1 }).limit(50).lean();

    res.json({ issues: issues.map(i => ({
      ...i,
      id:            i._id.toString(),
      staff_name:    i.staff_id?.name,
      property_name: i.property_id?.name,
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/issues/:id/resolve', protect, adminOnly, async (req, res) => {
  try {
    await StaffIssue.findByIdAndUpdate(req.params.id, { status: 'resolved' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sop', protect, adminOnly, async (req, res) => {
  try {
    const { property_id, sop_photo } = req.body;
    if (!property_id || !sop_photo) return res.status(400).json({ error: 'property_id and sop_photo required' });

    await PropertySOP.findOneAndUpdate(
      { property_id },
      { sop_photo },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
