const router   = require('express').Router();
const mongoose = require('mongoose');
const { User, Property, Booking, Review } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const now           = new Date();
    const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      totalProperties,
      activeProperties,
      totalBookings,
      confirmedBookings,
      pendingBookings,
      cancelledBookings,
      activeBookings,
      totalUsers,
      revenueAgg,
      monthRevenueAgg,
    ] = await Promise.all([
      Property.countDocuments(),
      Property.countDocuments({ status: 'Active' }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'confirmed' }),
      Booking.countDocuments({ status: 'pending' }),
      Booking.countDocuments({ status: 'cancelled' }),
      Booking.countDocuments({ status: { $in: ['confirmed', 'checked_in'] } }),
      User.countDocuments({ role: 'user' }),
      Booking.aggregate([
        { $match: { status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            status:     'confirmed',
            created_at: { $gte: startOfMonth, $lt: startOfNextMonth },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const totalRevenue = revenueAgg[0]?.total || 0;
    const monthRevenue = monthRevenueAgg[0]?.total || 0;

    // Recent bookings
    const recentBookingsDocs = await Booking.find()
      .populate('user_id', 'name email')
      .populate('property_id', 'name')
      .sort({ created_at: -1 })
      .limit(10)
      .lean();

    const recentBookings = recentBookingsDocs.map(b => ({
      ...b,
      user_name:     b.user_id?.name,
      property_name: b.property_id?.name,
    }));

    // Monthly revenue chart (last 6 months)
    const monthlyRevenue = await Booking.aggregate([
      { $match: { status: 'confirmed' } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m', date: '$created_at' },
          },
          revenue:  { $sum: '$amount' },
          bookings: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 6 },
      { $project: { _id: 0, month: '$_id', revenue: 1, bookings: 1 } },
    ]);

    res.json({
      stats: {
        totalProperties,
        activeProperties,
        totalBookings,
        confirmedBookings,
        pendingBookings,
        cancelledBookings,
        activeBookings,
        totalUsers,
        totalRevenue,
        monthRevenue,
      },
      recentBookings,
      monthlyRevenue,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/today  — today's check-ins and check-outs
router.get('/today', async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [checkinDocs, checkoutDocs] = await Promise.all([
      Booking.find({
        checkin: today,
        status:  { $in: ['pending', 'confirmed', 'checked_in'] },
      }).populate('property_id', 'name location').lean(),

      Booking.find({
        checkout: today,
        status:   { $in: ['confirmed', 'checked_in', 'checked_out'] },
      }).populate('property_id', 'name location').lean(),
    ]);

    const mapBooking = b => ({
      id:                b._id.toString(),
      guest_name:        b.guest_name,
      guest_phone:       b.guest_phone,
      checkin:           b.checkin,
      checkout:          b.checkout,
      guests:            b.guests,
      status:            b.status,
      property_id:       b.property_id?._id?.toString(),
      property_name:     b.property_id?.name,
      property_location: b.property_id?.location,
    });

    res.json({
      date:     today,
      checkins:  checkinDocs.map(mapBooking),
      checkouts: checkoutDocs.map(mapBooking),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/bookings  — filterable list (status, from, to)
router.get('/bookings', async (req, res) => {
  const { status, from, to } = req.query;
  try {
    const filter = {};
    if (status) filter.status  = status;
    if (from)   filter.checkin = { ...filter.checkin, $gte: from };
    if (to)     filter.checkin = { ...filter.checkin, $lte: to };

    const docs = await Booking.find(filter)
      .populate('user_id', 'name')
      .populate('property_id', 'name')
      .sort({ created_at: -1 })
      .lean();

    const bookings = docs.map(b => ({
      ...b,
      user_name:     b.user_id?.name,
      property_name: b.property_id?.name,
    }));

    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await User.aggregate([
      {
        $lookup: {
          from:         'bookings',
          localField:   '_id',
          foreignField: 'user_id',
          as:           'bookings',
        },
      },
      {
        $addFields: { booking_count: { $size: '$bookings' } },
      },
      {
        $project: { password: 0, bookings: 0, __v: 0 },
      },
      { $sort: { created_at: -1 } },
    ]);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/reviews — all reviews with user + property info
router.get('/reviews', async (req, res) => {
  try {
    const docs = await Review.find()
      .populate('user_id', 'name')
      .populate('property_id', 'name')
      .sort({ created_at: -1 })
      .lean();

    const reviews = docs.map(r => ({
      ...r,
      user_name:     r.user_id?.name,
      property_name: r.property_id?.name,
    }));

    res.json({ reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role))
    return res.status(400).json({ error: 'Role must be user or admin' });
  try {
    await User.findByIdAndUpdate(req.params.id, { role });
    res.json({ message: 'Role updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
