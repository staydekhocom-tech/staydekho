const router  = require('express').Router();
const crypto  = require('crypto');
const Razorpay = require('razorpay');
const db      = require('../db/database');
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

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Not authorized' });
    if (booking.status !== 'pending')
      return res.status(400).json({ error: 'Booking is not in pending state' });

    const amountInPaise = booking.amount * 100;

    const order = await razorpay.orders.create({
      amount:   amountInPaise,
      currency: 'INR',
      receipt:  `booking_${booking.id}_${Date.now()}`,
      notes:    { booking_id: String(booking.id), user_id: String(req.user.id) },
    });

    // Save payment record (created state)
    db.prepare(`
      INSERT INTO payments (booking_id, razorpay_order_id, amount, currency, status)
      VALUES (?, ?, ?, 'INR', 'created')
    `).run(booking.id, order.id, amountInPaise);

    // Save order_id on booking for later verification
    db.prepare('UPDATE bookings SET razorpay_order_id = ? WHERE id = ?').run(order.id, booking.id);

    res.json({
      order_id:   order.id,
      amount:     order.amount,
      currency:   order.currency,
      key_id:     process.env.RAZORPAY_KEY_ID,
      booking_id: booking.id,
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

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });

  // Update payment record to captured
  db.prepare(`
    UPDATE payments
    SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'captured'
    WHERE razorpay_order_id = ?
  `).run(razorpay_payment_id, razorpay_signature, razorpay_order_id);

  // Confirm booking and store payment ids
  db.prepare(`
    UPDATE bookings
    SET status = 'confirmed',
        razorpay_payment_id = ?
    WHERE id = ?
  `).run(razorpay_payment_id, booking_id);

  // Send confirmation email (non-blocking)
  const confirmed = db.prepare(`
    SELECT b.*, p.name as property_name
    FROM bookings b JOIN properties p ON b.property_id = p.id
    WHERE b.id = ?
  `).get(booking_id);

  if (confirmed) {
    sendEmail(
      confirmed.guest_email,
      `Booking Confirmed — #${confirmed.id} | StayDekho`,
      bookingConfirmedHtml(confirmed)
    ).catch(e => console.error('Confirmation email error:', e.message));
  }

  res.json({
    success:    true,
    booking_id: Number(booking_id),
    message:    'Payment verified and booking confirmed',
  });
});

// POST /api/payments/webhook  — Razorpay webhook (raw body, already set in server.js)
router.post('/webhook', (req, res) => {
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
      // Look up the booking by order_id and confirm it if not already done
      const pay = db.prepare('SELECT * FROM payments WHERE razorpay_order_id = ?').get(payment.order_id);
      if (pay && pay.status !== 'captured') {
        db.prepare(`UPDATE payments SET status = 'captured', razorpay_payment_id = ? WHERE id = ?`)
          .run(payment.id, pay.id);
        db.prepare(`UPDATE bookings SET status = 'confirmed', razorpay_payment_id = ? WHERE id = ? AND status = 'pending'`)
          .run(payment.id, pay.booking_id);
      }
    }
  }

  res.json({ status: 'ok' });
});

// GET /api/payments  — admin: all payments
router.get('/', protect, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  const rows = db.prepare(`
    SELECT p.*, b.guest_name, b.guest_email, pr.name as property_name
    FROM payments p
    JOIN bookings b ON p.booking_id = b.id
    JOIN properties pr ON b.property_id = pr.id
    ORDER BY p.created_at DESC
    LIMIT 100
  `).all();
  res.json({ payments: rows });
});

module.exports = router;
