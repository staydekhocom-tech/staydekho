const router = require('express').Router();
const { AddonRequest, Booking, User, Property } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/addons/mine  — current user's addon requests
router.get('/mine', protect, async (req, res) => {
  try {
    const docs = await AddonRequest.find({ user_id: req.user.id })
      .populate({
        path:     'booking_id',
        select:   'checkin checkout property_id',
        populate: { path: 'property_id', select: 'name' },
      })
      .sort({ created_at: -1 })
      .lean();

    const requests = docs.map(a => ({
      ...a,
      checkin:       a.booking_id?.checkin,
      checkout:      a.booking_id?.checkout,
      property_name: a.booking_id?.property_id?.name,
    }));

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/addons  body: { booking_id, addon, note }
router.post('/', protect, async (req, res) => {
  const { booking_id, addon, note } = req.body;
  if (!addon) return res.status(400).json({ error: 'addon required' });

  try {
    // If booking_id given, must belong to current user
    if (booking_id) {
      const own = await Booking.findOne({ _id: booking_id, user_id: req.user.id }).lean();
      if (!own) return res.status(403).json({ error: 'Booking not yours' });
    }

    const created = await AddonRequest.create({
      user_id:    req.user.id,
      booking_id: booking_id || null,
      addon,
      note:       note || '',
    });

    res.status(201).json({ request: created.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/addons  — admin only: all addon requests with user + property info
router.get('/', protect, adminOnly, async (_req, res) => {
  try {
    const docs = await AddonRequest.find()
      .populate('user_id', 'name phone')
      .populate({
        path:     'booking_id',
        select:   'checkin checkout property_id',
        populate: { path: 'property_id', select: 'name' },
      })
      .sort({ created_at: -1 })
      .lean();

    const requests = docs.map(a => ({
      ...a,
      user_name:     a.user_id?.name,
      user_phone:    a.user_id?.phone,
      property_name: a.booking_id?.property_id?.name,
    }));

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/addons/:id/status  — admin
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'rejected'];
  if (!allowed.includes(status))
    return res.status(400).json({ error: `invalid status. Must be one of: ${allowed.join(', ')}` });

  try {
    await AddonRequest.findByIdAndUpdate(req.params.id, { status });
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
