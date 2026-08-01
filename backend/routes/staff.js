const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const mongoose = require('mongoose');
const { Staff, StaffTask, CheckinToken, PropertySOP, StaffIssue, Booking, Property, DatePrice } = require('../db/models');
const { blockCalendarForBooking } = require('../services/bookingAutomation');
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

// Returns all assigned property ObjectIds for a staff member (deduped)
function staffPropIds(reqStaff) {
  const seen = new Set();
  const ids  = [];
  for (const raw of [reqStaff.property_id, ...(reqStaff.property_ids || [])]) {
    if (!raw) continue;
    const s = raw.toString();
    if (!seen.has(s)) { seen.add(s); ids.push(new mongoose.Types.ObjectId(s)); }
  }
  return ids;
}

// ── POST /api/staff/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN required' });

    const clean = String(phone).replace(/\D/g, '').slice(-10);
    const staff = await Staff.findOne({ phone: clean })
      .populate('property_id', 'name location images')
      .populate('property_ids', 'name location images')
      .lean();

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
        id:         staff._id.toString(),
        name:       staff.name,
        phone:      staff.phone,
        role:       staff.role,
        property:   staff.property_id || null,
        properties: staff.property_ids || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/staff/me ─────────────────────────────────────
router.get('/me', staffProtect, async (req, res) => {
  try {
    const staff = await Staff.findById(req.staff.id)
      .populate('property_id',  'name location images')
      .populate('property_ids', 'name location images')
      .lean();
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    const { pin: _pin, ...safe } = staff;
    res.json({ staff: { ...safe, id: staff._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/staff/dashboard ──────────────────────────────
router.get('/dashboard', staffProtect, async (req, res) => {
  try {
    const propIds  = staffPropIds(req.staff);
    const todayStr = today();

    if (!propIds.length) return res.json({ checkins: [], checkouts: [], upcoming: [], tasks: [], issues: [] });

    const propFilter = propIds.length === 1 ? propIds[0] : { $in: propIds };

    const [checkins, checkouts, upcoming, tasks, issues] = await Promise.all([
      Booking.find({ property_id: propFilter, checkin: todayStr, status: 'confirmed' })
        .select('guest_name guest_phone checkin checkout guests nights booking_no balance_amount notes status').lean(),
      Booking.find({ property_id: propFilter, checkout: todayStr, status: { $in: ['confirmed', 'checked_in'] } })
        .select('guest_name guest_phone checkin checkout guests nights booking_no balance_amount status').lean(),
      Booking.find({ property_id: propFilter, checkin: { $gt: todayStr }, status: 'confirmed' })
        .select('guest_name checkin checkout guests nights booking_no balance_amount').sort({ checkin: 1 }).limit(5).lean(),
      StaffTask.find({ property_id: propFilter, status: { $ne: 'done' }, due_date: { $gte: todayStr } })
        .sort({ due_date: 1 }).limit(10).lean(),
      StaffIssue.find({ property_id: propFilter, status: 'open' })
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
    const propIds = staffPropIds(req.staff);
    if (!propIds.length) return res.json({ tasks: [] });

    const propFilter = propIds.length === 1 ? propIds[0] : { $in: propIds };
    const tasks = await StaffTask.find({ property_id: propFilter, status: { $ne: 'done' } })
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
    const propIds = staffPropIds(req.staff);
    const propFilter = propIds.length === 1 ? propIds[0] : { $in: propIds };
    const task = await StaffTask.findOne({ _id: req.params.id, property_id: propFilter });
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

    const propIds = staffPropIds(req.staff);
    const propFilter = propIds.length === 1 ? propIds[0] : { $in: propIds };
    const booking = await Booking.findOne({
      _id: booking_id,
      property_id: propFilter,
      status: { $in: ['confirmed', 'pending'] },
    }).populate('property_id', 'name').lean();

    if (!booking) return res.status(404).json({ error: 'Booking not found or not confirmed' });

    const token = crypto.randomBytes(16).toString('hex');
    const photosStr = JSON.stringify(photos || []);

    const bookingPropId = booking.property_id?._id || booking.property_id;
    await CheckinToken.findOneAndUpdate(
      { booking_id },
      { property_id: bookingPropId, token, room_photos: photosStr, ready_at: new Date(), ready_by_staff_id: req.staff.id },
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
      .populate('property_ids', 'name')
      .sort({ created_at: -1 }).lean();
    res.json({ staff: staff.map(s => {
      const { pin: _pin, ...safe } = s;
      return {
        ...safe,
        id:             s._id.toString(),
        property_name:  s.property_id?.name || null,
        property_names: (s.property_ids || []).map(p => p.name),
      };
    }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', protect, adminOnly, async (req, res) => {
  try {
    const { name, phone, property_id, property_ids, role, pin } = req.body;
    if (!name || !phone || !pin) return res.status(400).json({ error: 'Name, phone and PIN required' });

    const clean = String(phone).replace(/\D/g, '').slice(-10);
    if (clean.length < 10) return res.status(400).json({ error: 'Enter valid 10-digit phone' });
    if (String(pin).length !== 4 || !/^\d{4}$/.test(String(pin)))
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

    const allPropIds  = Array.isArray(property_ids) && property_ids.length ? property_ids : (property_id ? [property_id] : []);
    const primaryProp = allPropIds[0] || null;

    const staff = await Staff.create({
      name, phone: clean,
      property_id:  primaryProp,
      property_ids: allPropIds,
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
    const { name, phone, property_id, property_ids, role, pin, status } = req.body;
    const s = await Staff.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Staff not found' });

    if (name)  s.name  = name;
    if (phone) s.phone = String(phone).replace(/\D/g, '').slice(-10);
    if (role)  s.role  = role;
    if (status) s.status = status;

    if (Array.isArray(property_ids)) {
      s.property_ids = property_ids;
      s.property_id  = property_ids[0] || null;
    } else if (property_id !== undefined) {
      s.property_id  = property_id || null;
    }

    if (pin) {
      if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
      s.pin = bcrypt.hashSync(String(pin), 10);
    }
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

// ── Admin: all sales bookings (with optional ?staff_id filter) ──
router.get('/sales-bookings', protect, adminOnly, async (req, res) => {
  try {
    const filter = { booked_by_staff_id: { $ne: null } };
    if (req.query.staff_id) filter.booked_by_staff_id = req.query.staff_id;

    const bookings = await Booking.find(filter)
      .populate('property_id', 'name')
      .sort({ created_at: -1 })
      .limit(200)
      .lean();

    res.json({
      bookings: bookings.map(b => ({
        id:                   b._id.toString(),
        booking_no:           b.booking_no,
        guest_name:           b.guest_name,
        guest_phone:          b.guest_phone,
        property_name:        b.property_id?.name || '—',
        checkin:              b.checkin,
        checkout:             b.checkout,
        guests:               b.guests,
        amount:               b.amount,
        total_amount:         b.total_amount,
        status:               b.status,
        created_at:           b.created_at,
        booked_by_staff_id:   b.booked_by_staff_id?.toString(),
        booked_by_name:       b.booked_by_name,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales: property availability calendar ─────────────────
router.get('/availability/:property_id', staffProtect, async (req, res) => {
  try {
    const { property_id } = req.params;
    const { year, month } = req.query;

    const now       = new Date();
    const y         = parseInt(year)  || now.getFullYear();
    const m         = parseInt(month) || now.getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate   = new Date(y, m, 0).toISOString().slice(0, 10); // last day of that month

    const [dpBlocked, bookings] = await Promise.all([
      DatePrice.find({ property_id, date: { $gte: startDate, $lte: endDate }, blocked: true }).select('date').lean(),
      Booking.find({
        property_id,
        status: { $in: ['confirmed', 'checked_in', 'pending'] },
        checkin:  { $lte: endDate },
        checkout: { $gte: startDate },
      }).select('checkin checkout').lean(),
    ]);

    const blockedSet = new Set(dpBlocked.map(d => d.date));
    for (const b of bookings) {
      const cin  = new Date(b.checkin);
      const cout = new Date(b.checkout);
      for (let d = new Date(cin); d < cout; d.setDate(d.getDate() + 1)) {
        blockedSet.add(d.toISOString().slice(0, 10));
      }
    }

    res.json({ blocked_dates: [...blockedSet] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales: list all active properties ────────────────────
router.get('/properties', staffProtect, async (req, res) => {
  try {
    const props = await Property.find({ status: 'Active' }).select('name location').lean();
    res.json({ properties: props.map(p => ({ id: p._id.toString(), name: p.name, location: p.location })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales: create a booking ───────────────────────────────
router.post('/sales-booking', staffProtect, async (req, res) => {
  if (req.staff.role !== 'sales') return res.status(403).json({ error: 'Sales role required' });
  try {
    const { property_id, guest_name, guest_phone, guest_email, checkin, checkout, guests, total_amount, amount, balance_amount, payment_method, notes } = req.body;
    if (!property_id || !guest_name || !checkin || !checkout)
      return res.status(400).json({ error: 'property_id, guest_name, checkin, checkout are required' });

    const property = await Property.findById(property_id).lean();
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const bookingNo  = (await Booking.countDocuments()) + 1;
    const nights     = Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / 86400000));
    const totalAmt   = parseFloat(total_amount)   || 0;
    const advanceAmt = parseFloat(amount)         || totalAmt;
    const balanceAmt = parseFloat(balance_amount) || Math.max(0, totalAmt - advanceAmt);

    const booking = await Booking.create({
      property_id,
      guest_name:         guest_name.trim(),
      guest_phone:        guest_phone?.trim() || '',
      guest_email:        guest_email?.trim() || '',
      checkin,
      checkout,
      guests:             parseInt(guests) || 1,
      nights,
      amount:             advanceAmt,
      total_amount:       totalAmt,
      balance_amount:     balanceAmt,
      payment_method:     payment_method || 'cash',
      notes:              notes?.trim() || '',
      status:             'confirmed',
      platform:           'direct',
      booking_no:         bookingNo,
      booked_by_staff_id: req.staff.id,
      booked_by_name:     req.staff.name,
    });

    blockCalendarForBooking(booking).catch(e => console.error('blockCalendar error:', e.message));

    res.json({ success: true, id: booking._id.toString(), booking_no: bookingNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales: my bookings list ───────────────────────────────
router.get('/my-bookings', staffProtect, async (req, res) => {
  if (req.staff.role !== 'sales') return res.status(403).json({ error: 'Sales role required' });
  try {
    const bookings = await Booking.find({ booked_by_staff_id: req.staff.id })
      .populate('property_id', 'name')
      .sort({ created_at: -1 })
      .limit(100)
      .lean();

    const now = new Date();
    res.json({
      bookings: bookings.map(b => ({
        id:            b._id.toString(),
        guest_name:    b.guest_name,
        guest_phone:   b.guest_phone,
        property_name: b.property_id?.name || '—',
        checkin:       b.checkin,
        checkout:      b.checkout,
        guests:        b.guests,
        nights:        b.nights,
        amount:        b.total_amount || b.amount,
        status:        b.status,
        booking_no:    b.booking_no,
        created_at:    b.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
