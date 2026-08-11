const router   = require('express').Router();
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const { Booking, Payment, Property, DatePrice } = require('../db/models');
const { protect } = require('../middleware/auth');
const { blockCalendarForBooking, createCleaningTaskForCheckout, notifyGuestBookingCreated } = require('../services/bookingAutomation');

// Lazy init — reads env vars at call time, not at module load
function getRazorpay() {
  const key_id     = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new Error('Razorpay keys not configured in environment variables');
  return new Razorpay({ key_id, key_secret });
}

// Extract best error message from Razorpay SDK errors
function rzpErrMsg(err) {
  return err?.error?.description
    || err?.error?.reason
    || err?.description
    || err?.message
    || JSON.stringify(err)
    || 'Payment order creation failed';
}

// POST /api/payments/create-guest-order
// Calculates price + creates Razorpay order WITHOUT touching the bookings table.
// Booking is only created in confirm-booking after payment is verified.
router.post('/create-guest-order', protect, async (req, res) => {
  try {
    const { property_id, checkin, checkout, guests } = req.body;
    if (!property_id || !checkin || !checkout)
      return res.status(400).json({ error: 'property_id, checkin, checkout required' });

    const property = await Property.findOne({ _id: property_id, status: 'Active' }).lean();
    if (!property) return res.status(404).json({ error: 'Property not found or inactive' });

    const cin  = new Date(checkin.slice(0, 10)  + 'T12:00:00');
    const cout = new Date(checkout.slice(0, 10) + 'T12:00:00');
    if (cout <= cin) return res.status(400).json({ error: 'Check-out must be after check-in' });

    const overlap = await Booking.findOne({
      property_id,
      status:   { $nin: ['cancelled', 'checked_out'] },
      checkin:  { $lt: checkout },
      checkout: { $gt: checkin },
    }).lean();
    if (overlap) return res.status(409).json({ error: 'These dates are already booked. Please choose different dates.' });

    const nights = Math.max(1, Math.round((cout - cin) / (1000 * 60 * 60 * 24)));
    const dpRows = await DatePrice.find({
      property_id, date: { $gte: checkin.slice(0, 10), $lt: checkout.slice(0, 10) },
      blocked: false, price: { $ne: null },
    }).lean();
    const dpMap = new Map(dpRows.map(dp => [dp.date, dp.price]));
    let base = 0;
    for (let i = 0; i < nights; i++) {
      const d = new Date(cin);
      d.setDate(d.getDate() + i);
      base += dpMap.get(d.toISOString().split('T')[0]) ?? property.price;
    }
    const gstRate = (base / nights) > 7500 ? 0.18 : 0.05;
    const total   = base + Math.round(base * gstRate);
    const advance = Math.round(total * 0.30);
    const balance = total - advance;

    const amountInPaise = Math.round(advance * 100);
    if (amountInPaise < 100) return res.status(400).json({ error: 'Amount too low' });

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount:   amountInPaise,
      currency: 'INR',
      receipt:  `go_${Date.now()}`.slice(0, 40),
      notes:    { property_id: property_id.toString(), user_id: String(req.user.id) },
    });

    res.json({
      order_id:      order.id,
      amount:        order.amount,
      currency:      order.currency,
      key_id:        process.env.RAZORPAY_KEY_ID,
      property_name: property.name,
      booking_meta:  { property_id, checkin, checkout, guests: guests || 1, nights, total_amount: total, amount: advance, balance_amount: balance },
    });
  } catch (err) {
    console.error('create-guest-order error:', err);
    res.status(500).json({ error: rzpErrMsg(err) });
  }
});

// POST /api/payments/confirm-booking
// Verifies Razorpay payment signature then creates booking directly as 'confirmed'.
// No pending booking is left behind if payment is cancelled/fails.
router.post('/confirm-booking', protect, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_meta, guest_name, guest_email, guest_phone } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_meta)
    return res.status(400).json({ error: 'payment details and booking_meta required' });

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });

  try {
    const { property_id, checkin, checkout, guests, nights, total_amount, amount, balance_amount } = booking_meta;

    // Race-condition guard: re-check availability
    const overlap = await Booking.findOne({
      property_id, status: { $nin: ['cancelled', 'checked_out'] },
      checkin: { $lt: checkout }, checkout: { $gt: checkin },
    }).lean();
    if (overlap) return res.status(409).json({ error: 'These dates just got booked by someone else. Please contact us.' });

    const bookingNo = (await Booking.countDocuments()) + 1;
    const booking = await Booking.create({
      user_id:             req.user.id,
      booking_no:          bookingNo,
      property_id,
      guest_name:          guest_name  || req.user.name,
      guest_email:         guest_email || req.user.email,
      guest_phone:         guest_phone || req.user.phone || '',
      checkin, checkout,
      guests:              guests || 1,
      nights:              nights || 1,
      amount,
      total_amount,
      balance_amount,
      payment_type:        'partial',
      balance_paid:        false,
      status:              'confirmed',
      razorpay_order_id,
      razorpay_payment_id,
    });

    await Payment.create({
      booking_id: booking._id, razorpay_order_id, razorpay_payment_id, razorpay_signature,
      amount: Math.round(amount * 100), currency: 'INR', status: 'captured',
    });

    const confirmed = await Booking.findById(booking._id)
      .populate('property_id', 'name owner_name owner_phone caretaker_name caretaker_phone').lean();
    if (confirmed) {
      const emailData = { ...confirmed, property_name: confirmed.property_id?.name, id: confirmed._id.toString() };
      notifyGuestBookingCreated(emailData, emailData.property_name).catch(e => console.error('Notify:', e.message));
      blockCalendarForBooking(confirmed.property_id._id, confirmed.checkin, confirmed.checkout).catch(() => {});
      createCleaningTaskForCheckout(confirmed.property_id._id, confirmed.checkout).catch(() => {});
      require('../services/whatsapp').notifyTeamNewBooking(confirmed, confirmed.property_id).catch(() => {});
    }

    res.json({ success: true, booking_id: booking._id.toString(), booking_no: bookingNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/create-order
// body: { booking_id }  — creates a Razorpay order for the given booking
router.post('/create-order', protect, async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });

    const booking = await Booking.findById(booking_id).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role !== 'admin' && booking.user_id?.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });
    if (booking.status !== 'pending')
      return res.status(400).json({ error: 'Booking is not in pending state' });

    const amountInPaise = Math.round(booking.amount * 100);
    if (amountInPaise < 100) return res.status(400).json({ error: 'Booking amount too low (minimum ₹1)' });

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount:   amountInPaise,
      currency: 'INR',
      receipt:  `bk_${booking._id}_${Date.now()}`.slice(0, 40),
      notes:    { booking_id: booking._id.toString(), user_id: String(req.user.id) },
    });

    // Save payment record (created state)
    await Payment.create({
      booking_id:        booking._id,
      razorpay_order_id: order.id,
      amount:            amountInPaise,
      currency:          'INR',
      status:            'created',
    });

    // Save order_id on booking for later verification
    await Booking.findByIdAndUpdate(booking._id, { razorpay_order_id: order.id });

    res.json({
      order_id:   order.id,
      amount:     order.amount,
      currency:   order.currency,
      key_id:     process.env.RAZORPAY_KEY_ID,
      booking_id: booking._id.toString(),
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: rzpErrMsg(err) });
  }
});

// POST /api/payments/verify
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id }
router.post('/verify', protect, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id)
    return res.status(400).json({ error: 'order_id, payment_id, signature and booking_id required' });

  // Verify HMAC signature
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Payment signature verification failed' });

  try {
    const booking = await Booking.findById(booking_id).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role !== 'admin' && booking.user_id?.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });

    // Update payment record to captured
    await Payment.findOneAndUpdate(
      { razorpay_order_id },
      {
        razorpay_payment_id,
        razorpay_signature,
        status: 'captured',
      }
    );

    // Confirm booking and store payment ids
    await Booking.findByIdAndUpdate(booking_id, {
      status:              'confirmed',
      razorpay_payment_id,
    });

    // Send confirmation email (non-blocking)
    const confirmed = await Booking.findById(booking_id)
      .populate('property_id', 'name owner_name owner_phone caretaker_name caretaker_phone')
      .lean();
    if (confirmed) {
      const emailData = {
        ...confirmed,
        property_name: confirmed.property_id?.name,
        id:            confirmed._id.toString(),
      };
      // ── Automation chain: email + SMS notify, calendar auto-block, auto cleaning task ──
      notifyGuestBookingCreated(emailData, emailData.property_name)
        .catch(e => console.error('Notify error:', e.message));
      blockCalendarForBooking(confirmed.property_id._id, confirmed.checkin, confirmed.checkout)
        .catch(e => console.error('Calendar block error:', e.message));
      createCleaningTaskForCheckout(confirmed.property_id._id, confirmed.checkout)
        .catch(e => console.error('Cleaning task error:', e.message));
      // WhatsApp: owner + caretaker + admin ko turant update
      require('../services/whatsapp').notifyTeamNewBooking(confirmed, confirmed.property_id)
        .catch(e => console.error('Team WhatsApp error:', e.message));
    }

    res.json({
      success:    true,
      booking_id: booking_id.toString(),
      message:    'Payment verified and booking confirmed',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/webhook  — Razorpay webhook (raw body, already set in server.js)
router.post('/webhook', async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return res.json({ status: 'ignored' });

  const signature = req.headers['x-razorpay-signature'];
  const expected  = crypto
    .createHmac('sha256', webhookSecret)
    .update(req.body)
    .digest('hex');

  if (signature !== expected)
    return res.status(400).json({ error: 'Invalid webhook signature' });

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  if (event.event === 'payment.captured') {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      try {
        const pay = await Payment.findOne({ razorpay_order_id: payment.order_id }).lean();
        if (pay && pay.status !== 'captured') {
          await Payment.findByIdAndUpdate(pay._id, {
            status:              'captured',
            razorpay_payment_id: payment.id,
          });
          await Booking.findOneAndUpdate(
            { _id: pay.booking_id, status: 'pending' },
            { status: 'confirmed', razorpay_payment_id: payment.id }
          );
        }
      } catch (e) {
        console.error('Webhook processing error:', e.message);
      }
    }
  }

  res.json({ status: 'ok' });
});

// GET /api/payments  — admin: all payments
router.get('/', protect, async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  try {
    const payments = await Payment.find()
      .populate({
        path:     'booking_id',
        select:   'guest_name guest_email property_id',
        populate: { path: 'property_id', select: 'name' },
      })
      .sort({ created_at: -1 })
      .limit(100)
      .lean();

    const rows = payments.map(p => ({
      ...p,
      guest_name:    p.booking_id?.guest_name,
      guest_email:   p.booking_id?.guest_email,
      property_name: p.booking_id?.property_id?.name,
    }));

    res.json({ payments: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
