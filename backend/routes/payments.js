const router   = require('express').Router();
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const { Booking, Payment, Property } = require('../db/models');
const { protect } = require('../middleware/auth');
const { sendEmail, bookingConfirmedHtml } = require('../services/email');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// POST /api/payments/create-order
// body: { booking_id }  — creates a Razorpay order for the given booking
router.post('/create-order', protect, async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });

    const booking = await Booking.findById(booking_id).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.user_id.toString() !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Not authorized' });
    if (booking.status !== 'pending')
      return res.status(400).json({ error: 'Booking is not in pending state' });

    const amountInPaise = booking.amount * 100;

    const order = await razorpay.orders.create({
      amount:   amountInPaise,
      currency: 'INR',
      receipt:  `booking_${booking._id}_${Date.now()}`,
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
    res.status(500).json({ error: err.message || 'Payment order creation failed' });
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
    if (booking.user_id.toString() !== req.user.id && req.user.role !== 'admin')
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
      .populate('property_id', 'name')
      .lean();
    if (confirmed) {
      const emailData = {
        ...confirmed,
        property_name: confirmed.property_id?.name,
        id:            confirmed._id.toString(),
      };
      sendEmail(
        confirmed.guest_email,
        `Booking Confirmed — #${emailData.id} | StayDekho`,
        bookingConfirmedHtml(emailData)
      ).catch(e => console.error('Confirmation email error:', e.message));
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
