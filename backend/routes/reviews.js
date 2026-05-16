const router = require('express').Router();
const { Review, Property, Booking } = require('../db/models');
const { protect } = require('../middleware/auth');

// GET /api/reviews/featured  — public, for homepage carousel (top rated, no property_id needed)
router.get('/featured', async (req, res) => {
  try {
    const docs = await Review.find({ rating: { $gte: 4 } })
      .populate('user_id', 'name')
      .sort({ rating: -1, created_at: -1 })
      .limit(12)
      .lean();

    const reviews = docs.map(r => ({
      ...r,
      user_name:     r.user_id?.name || 'Guest',
      property_name: r.property_name || 'StayDekho Property',
    }));

    res.json({ reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviews?property_id=X  — public
router.get('/', async (req, res) => {
  const { property_id } = req.query;
  if (!property_id) return res.status(400).json({ error: 'property_id is required' });

  try {
    const docs = await Review.find({ property_id })
      .populate('user_id', 'name')
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    const reviews = docs.map(r => ({
      ...r,
      user_name: r.user_id?.name || 'Guest',
    }));

    const avg = reviews.length
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null;

    res.json({ reviews, avg_rating: avg, count: reviews.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews  — auth required
router.post('/', protect, async (req, res) => {
  const { property_id, booking_id, rating, text } = req.body;
  if (!property_id || !rating || !text)
    return res.status(400).json({ error: 'property_id, rating and text are required' });
  if (rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });

  try {
    // Check property exists
    const prop = await Property.findById(property_id).lean();
    if (!prop) return res.status(404).json({ error: 'Property not found' });

    // If booking_id provided, check ownership
    if (booking_id) {
      const bk = await Booking.findOne({ _id: booking_id, user_id: req.user.id }).lean();
      if (!bk) return res.status(403).json({ error: 'Booking not found or not yours' });
    }

    // One review per user per property — update if exists
    const existing = await Review.findOne({ user_id: req.user.id, property_id }).lean();
    if (existing) {
      await Review.findByIdAndUpdate(existing._id, {
        rating:     Number(rating),
        text:       String(text).trim(),
        booking_id: booking_id || null,
      });
      const updated = await Review.findById(existing._id)
        .populate('user_id', 'name')
        .lean();
      return res.json({
        review: { ...updated, user_name: updated.user_id?.name || 'Guest' },
        updated: true,
      });
    }

    const created = await Review.create({
      user_id:    req.user.id,
      property_id,
      booking_id: booking_id || null,
      rating:     Number(rating),
      text:       String(text).trim(),
    });

    const review = await Review.findById(created._id)
      .populate('user_id', 'name')
      .lean();

    res.status(201).json({
      review: { ...review, user_name: review.user_id?.name || 'Guest' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reviews/:id  — only own review or admin
router.delete('/:id', protect, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id).lean();
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (req.user.role !== 'admin' && review.user_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Review deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
