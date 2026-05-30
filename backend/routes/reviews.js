const router = require('express').Router();
const { Review, Property, Booking } = require('../db/models');
const { protect } = require('../middleware/auth');

// GET /api/reviews/featured  — public, for homepage carousel (top rated, no property_id needed)
router.get('/featured', async (req, res) => {
  try {
    const docs = await Review.find({ rating: { $gte: 4 } })
      .populate('user_id', 'name')
      .populate('property_id', 'name images')
      .sort({ rating: -1, created_at: -1 })
      .limit(12)
      .lean();

    const reviews = docs.map(r => {
      // Use review image if set, else use property's first image as card background
      const propImg = Array.isArray(r.property_id?.images) ? r.property_id.images[0] : null;
      return {
        ...r,
        user_name:     r.guest_name || r.user_id?.name || 'Guest',
        image_url:     r.image_url || propImg || '',
        property_name: r.property_name || r.property_id?.name || 'StayDekho Property',
      };
    });

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
// Admin can also pass: guest_name, image_url (to create curated homepage reviews)
router.post('/', protect, async (req, res) => {
  const { property_id, booking_id, rating, text, guest_name, image_url } = req.body;
  if (!property_id || !rating || !text)
    return res.status(400).json({ error: 'property_id, rating and text are required' });
  if (rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });

  try {
    // Check property exists
    const prop = await Property.findById(property_id).lean();
    if (!prop) return res.status(404).json({ error: 'Property not found' });

    const isAdmin = req.user.role === 'admin';

    // Non-admin: one review per user per property — update if exists
    if (!isAdmin) {
      if (booking_id) {
        const bk = await Booking.findOne({ _id: booking_id, user_id: req.user.id }).lean();
        if (!bk) return res.status(403).json({ error: 'Booking not found or not yours' });
      }
      const existing = await Review.findOne({ user_id: req.user.id, property_id }).lean();
      if (existing) {
        await Review.findByIdAndUpdate(existing._id, {
          rating:     Number(rating),
          text:       String(text).trim(),
          booking_id: booking_id || null,
        });
        const updated = await Review.findById(existing._id).populate('user_id', 'name').lean();
        return res.json({
          review: { ...updated, user_name: updated.user_id?.name || 'Guest' },
          updated: true,
        });
      }
    }

    // Build review data
    const reviewData = {
      user_id:       req.user.id,
      property_id,
      booking_id:    booking_id || null,
      rating:        Number(rating),
      text:          String(text).trim(),
      property_name: prop.name || '',
    };
    // Admin extras — custom guest name & photo
    if (isAdmin) {
      if (guest_name) reviewData.guest_name = String(guest_name).trim();
      if (image_url)  reviewData.image_url  = String(image_url).trim();
    }

    const created = await Review.create(reviewData);
    const review  = await Review.findById(created._id).populate('user_id', 'name').lean();

    res.status(201).json({
      review: {
        ...review,
        user_name: review.guest_name || review.user_id?.name || 'Guest',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reviews/:id  — admin only (edit guest_name, rating, text, image_url)
router.put('/:id', protect, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id).lean();
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (req.user.role !== 'admin' && review.user_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });

    const { rating, text, guest_name, image_url } = req.body;
    const update = {};
    if (rating)     update.rating     = Number(rating);
    if (text)       update.text       = String(text).trim();
    if (guest_name !== undefined) update.guest_name = String(guest_name).trim();
    if (image_url  !== undefined) update.image_url  = String(image_url).trim();

    const updated = await Review.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('user_id', 'name').lean();
    res.json({ review: { ...updated, user_name: updated.guest_name || updated.user_id?.name || 'Guest' } });
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
