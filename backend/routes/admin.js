const router   = require('express').Router();
const mongoose = require('mongoose');
const { User, Property, Booking, Review } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');
const { notifyStaffNewBooking } = require('../services/notify');

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const now           = new Date();
    const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Actually-in-hand money:
    // direct/walkin → advance + balance (if collected)
    // OTA → net payout, but only once platform has transferred it (payout_received)
    const receivedExpr = {
      $cond: [
        { $in: [{ $ifNull: ['$platform', 'direct'] }, ['direct', 'walkin']] },
        { $add: [
            { $ifNull: ['$amount', 0] },
            { $cond: [{ $eq: ['$balance_paid', true] }, { $ifNull: ['$balance_amount', 0] }, 0] },
        ] },
        { $cond: [
            { $eq: ['$payout_received', true] },
            { $ifNull: ['$net_payout', { $ifNull: ['$total_amount', '$amount'] }] },
            0,
        ] },
      ],
    };

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
        { $match: { status: { $in: ['confirmed', 'checked_in', 'checked_out'] } } },
        { $group: {
            _id: null,
            received: { $sum: receivedExpr },
            booked:   { $sum: { $ifNull: ['$total_amount', '$amount'] } },
        } },
      ]),
      Booking.aggregate([
        {
          $match: {
            status:     { $in: ['confirmed', 'checked_in', 'checked_out'] },
            created_at: { $gte: startOfMonth, $lt: startOfNextMonth },
          },
        },
        { $group: {
            _id: null,
            received: { $sum: receivedExpr },
            booked:   { $sum: { $ifNull: ['$total_amount', '$amount'] } },
        } },
      ]),
    ]);

    const totalRevenue     = revenueAgg[0]?.received || 0;
    const totalBookedValue = revenueAgg[0]?.booked   || 0;
    const monthRevenue     = monthRevenueAgg[0]?.received || 0;  // received from bookings MADE this month
    const monthBookedValue = monthRevenueAgg[0]?.booked   || 0;  // total value of bookings MADE this month

    // Stays this month: bookings where checkin falls in current month (regardless of when booked)
    const monthStr     = startOfMonth.toISOString().split('T')[0];
    const nextMonthStr = startOfNextMonth.toISOString().split('T')[0];
    const monthStaysAgg = await Booking.aggregate([
      {
        $match: {
          status:  { $in: ['confirmed', 'checked_in', 'checked_out'] },
          checkin: { $gte: monthStr, $lt: nextMonthStr },
        },
      },
      { $group: {
          _id: null,
          booked:   { $sum: { $ifNull: ['$total_amount', '$amount'] } },
          received: { $sum: receivedExpr },
      } },
    ]);
    const monthStaysBooked   = monthStaysAgg[0]?.booked   || 0;
    const monthStaysReceived = monthStaysAgg[0]?.received || 0;

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

    // Property-wise revenue (booked value + received, non-cancelled)
    const propertyRevenue = await Booking.aggregate([
      { $match: { status: { $in: ['confirmed', 'checked_in', 'checked_out'] } } },
      { $group: {
          _id:      '$property_id',
          booked:   { $sum: { $ifNull: ['$total_amount', '$amount'] } },
          received: { $sum: receivedExpr },
          bookings: { $sum: 1 },
      } },
      { $lookup: { from: 'properties', localField: '_id', foreignField: '_id', as: 'prop' } },
      { $project: {
          _id: 0,
          property_id:   '$_id',
          property_name: { $ifNull: [{ $arrayElemAt: ['$prop.name', 0] }, 'Unknown'] },
          booked: 1, received: 1, bookings: 1,
      } },
      { $sort: { booked: -1 } },
    ]);

    // Owner payable tracking — Aug 1 2026 se, pehle wale sab clear ho gaye
    const OWNER_TRACKING_START = new Date('2026-08-01T00:00:00Z');
    const ownerRows = await Booking.find({
      status:     { $in: ['confirmed', 'checked_in', 'checked_out'] },
      created_at: { $gte: OWNER_TRACKING_START },
    }).select('total_amount amount nights platform net_payout owner_paid').lean();

    let ownerPending = 0, ownerPaidTotal = 0;
    for (const b of ownerRows) {
      const totalAmt = b.total_amount || b.amount || 0;
      const platform = b.platform || 'direct';
      const isDirect = platform === 'direct' || platform === 'walkin';
      let base;
      if (isDirect) {
        let g = 0.05;
        if ((totalAmt / (b.nights || 1)) / 1.05 > 7500) g = 0.18;
        base = Math.round(totalAmt / (1 + g));
      } else {
        base = b.net_payout != null ? b.net_payout : totalAmt;
      }
      const ownerShare = Math.round(base * 0.70);
      if (b.owner_paid) ownerPaidTotal += ownerShare; else ownerPending += ownerShare;
    }

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
        totalBookedValue,
        monthRevenue,
        monthBookedValue,
        monthStaysBooked,
        monthStaysReceived,
        monthStr,
        ownerPending,
        ownerPaidTotal,
      },
      recentBookings,
      monthlyRevenue,
      propertyRevenue,
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

// POST /api/admin/booking  — admin manually creates a booking
router.post('/booking', async (req, res) => {
  try {
    const { guest_name, guest_phone, guest_email, property_id, checkin, checkout, guests, amount, payment_method, notes } = req.body;

    if (!guest_name || !property_id || !checkin || !checkout)
      return res.status(400).json({ error: 'guest_name, property_id, checkin, checkout are required' });

    const property = await Property.findById(property_id).lean();
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const cin  = new Date(checkin);
    const cout = new Date(checkout);
    if (cout <= cin) return res.status(400).json({ error: 'Check-out must be after check-in' });
    const nights = Math.ceil((cout - cin) / (1000 * 60 * 60 * 24));

    const finalAmount = amount ? parseInt(amount) : property.price * nights;
    const status = payment_method === 'pending' ? 'pending' : 'confirmed';

    const booking = await Booking.create({
      user_id:        req.user.id,
      property_id,
      guest_name:     guest_name.trim(),
      guest_email:    guest_email?.trim() || '',
      guest_phone:    guest_phone ? String(guest_phone).replace(/\D/g, '').slice(-10) : '',
      checkin,
      checkout,
      guests:         guests || 1,
      nights,
      amount:         finalAmount,
      total_amount:   finalAmount,
      status,
      platform:       'walkin',
      notes:          notes || '',
    });

    res.status(201).json({ success: true, booking_id: booking._id.toString(), status, nights, amount: finalAmount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
