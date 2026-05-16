const router = require('express').Router();
const mongoose = require('mongoose');
const { Property, Review, DatePrice, Booking } = require('../db/models');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Map DB doc → frontend-friendly shape
function normalize(p) {
  const raw = JSON.parse(p.images || '[]');
  const categorized_images = raw.map(img =>
    typeof img === 'string' ? { url: img, cat: 'Exterior' } : img
  );
  const images = categorized_images.map(i => i.url);

  const amenities = p.amenities
    ? p.amenities.split(',').map(a => a.trim()).filter(Boolean)
    : [];
  const rules  = JSON.parse(p.rules  || '[]');
  const addons = JSON.parse(p.addons || '[]');

  const property_types = JSON.parse(p.property_types || '[]');

  return {
    ...p,
    id:             String(p._id),   // frontend uses p.id for property links
    title:          p.name,
    main_image:     images[0] || null,
    images,
    categorized_images,
    baths:          p.bathrooms,
    max_guests:     p.guests,
    amenities,
    rules,
    addons,
    property_types,
    map_url:        p.map_url       || '',
    brochure_url:   p.brochure_url  || '',
    fomo_enabled:   p.fomo_enabled !== false && p.fomo_enabled !== 0,
    fomo_bookings:  p.fomo_bookings,
    fomo_viewers:   p.fomo_viewers,
    checkin_time:   p.checkin_time  || '2:00 PM',
    checkout_time:  p.checkout_time || '11:00 AM',
    rating:         null,
    review_count:   0,
    badge:          null,
    wishlisted:     false,
  };
}

// GET /api/properties — public
router.get('/', optionalAuth, async (req, res) => {
  const { location, q, minPrice, maxPrice, guests, status, type } = req.query;
  const search = location || q;
  const isAdmin = req.user && req.user.role === 'admin';

  try {
    const filter = {};
    if (status) {
      filter.status = status;
    } else if (!isAdmin) {
      filter.status = 'Active';
    }
    if (search) {
      // Escape special regex chars to prevent ReDoS
      const esc = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { location: new RegExp(esc, 'i') },
        { name:     new RegExp(esc, 'i') },
      ];
    }
    if (guests)   filter.guests = { $gte: Number(guests) };
    if (minPrice) filter.price  = { ...filter.price, $gte: Number(minPrice) };
    if (maxPrice) filter.price  = { ...filter.price, $lte: Number(maxPrice) };
    if (type) {
      const escType = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.property_types = new RegExp(`"${escType}"`);
    }

    const props = await Property.find(filter).sort({ created_at: -1 }).lean();
    const today = new Date().toISOString().split('T')[0];

    const rows = await Promise.all(props.map(async (p) => {
      const norm = normalize(p);

      // avg rating
      const aggResult = await Review.aggregate([
        { $match: { property_id: new mongoose.Types.ObjectId(p._id) } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      if (aggResult.length > 0) {
        norm.rating       = String(aggResult[0].avg.toFixed(1));
        norm.review_count = aggResult[0].count;
      }

      // today's date price
      const dp = await DatePrice.findOne({
        property_id: p._id,
        date: today,
        blocked: false,
        price: { $ne: null },
      }).lean();
      norm.today_price = dp ? dp.price : null;

      return norm;
    }));

    res.json({ properties: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id — public
router.get('/:id', async (req, res) => {
  try {
    const row = await Property.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ error: 'Property not found' });

    // Get admin user as host
    const { User } = require('../db/models');
    const host = await User.findOne({ role: 'admin' }).select('name email created_at').lean() || {};

    // Get reviews with user info
    const reviewDocs = await Review.find({ property_id: row._id })
      .populate('user_id', 'name')
      .sort({ created_at: -1 })
      .limit(20)
      .lean();

    const reviews = reviewDocs.map(r => ({
      ...r,
      user_name: r.user_id?.name || 'Guest',
    }));

    const avgRating = reviews.length
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null;

    const prop = normalize(row);
    prop.rating       = avgRating;
    prop.review_count = reviews.length;

    res.json({ property: prop, host, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties — admin only
router.post('/', protect, adminOnly, upload.array('images', 10), async (req, res) => {
  const data = req.body;

  if (!data.name || !data.location || !data.price)
    return res.status(400).json({ error: 'Name, location and price are required' });

  try {
    let finalImages = [];
    if (req.files && req.files.length > 0) {
      finalImages = req.files.map(file => ({ url: file.path, cat: 'Exterior' }));
    } else if (data.images) {
      let rawImages = data.images;
      if (typeof rawImages === 'string') {
        try { rawImages = JSON.parse(rawImages); }
        catch (e) { rawImages = [{ url: rawImages, cat: 'Exterior' }]; }
      }
      finalImages = rawImages;
    }

    const propTypes = Array.isArray(data.property_types)
      ? JSON.stringify(data.property_types)
      : (typeof data.property_types === 'string' ? data.property_types : '[]');

    const created = await Property.create({
      name:           data.name,
      location:       data.location,
      price:          data.price,
      guests:         data.guests         || 10,
      beds:           data.beds           || 4,
      bathrooms:      data.bathrooms      || 3,
      description:    data.description    || '',
      amenities:      data.amenities      || '',
      images:         JSON.stringify(finalImages),
      status:         data.status         || 'Active',
      map_url:        data.map_url        || '',
      brochure_url:   data.brochure_url   || '',
      rules:          JSON.stringify(data.rules  || []),
      addons:         JSON.stringify(data.addons || []),
      checkin_time:   data.checkin_time   || '2:00 PM',
      checkout_time:  data.checkout_time  || '11:00 AM',
      fomo_bookings:  data.fomo_bookings  ?? null,
      fomo_viewers:   data.fomo_viewers   ?? null,
      fomo_enabled:   data.fomo_enabled === false ? false : true,
      property_types: propTypes,
    });

    res.status(201).json({ property: normalize(created.toObject()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/properties/:id — admin only
router.put('/:id', protect, adminOnly, upload.array('images', 10), async (req, res) => {
  try {
    const existing = await Property.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Property not found' });

    const data = req.body;
    let finalImages = existing.images;

    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => ({ url: file.path, cat: 'Exterior' }));
      finalImages = JSON.stringify(newImages);
    } else if (data.images) {
      let rawImages = data.images;
      if (typeof rawImages === 'string') {
        try { rawImages = JSON.parse(rawImages); }
        catch (e) { rawImages = [{ url: rawImages, cat: 'Exterior' }]; }
      }
      finalImages = JSON.stringify(rawImages);
    }

    const updPropTypes = data.property_types !== undefined
      ? (Array.isArray(data.property_types) ? JSON.stringify(data.property_types) : data.property_types)
      : (existing.property_types || '[]');

    const updateData = {
      name:          data.name         || existing.name,
      location:      data.location     || existing.location,
      price:         data.price        || existing.price,
      guests:        data.guests       || existing.guests,
      beds:          data.beds         || existing.beds,
      bathrooms:     data.bathrooms    || existing.bathrooms,
      description:   data.description  ?? existing.description,
      amenities:     data.amenities    ?? existing.amenities,
      images:        finalImages,
      status:        data.status       || existing.status,
      checkin_time:  data.checkin_time  ?? existing.checkin_time  ?? '2:00 PM',
      checkout_time: data.checkout_time ?? existing.checkout_time ?? '11:00 AM',
      rules:         data.rules !== undefined
        ? (typeof data.rules === 'string' ? data.rules : JSON.stringify(data.rules || []))
        : (existing.rules || '[]'),
      addons: data.addons !== undefined
        ? (typeof data.addons === 'string' ? data.addons : JSON.stringify(data.addons || []))
        : (existing.addons || '[]'),
      map_url:       data.map_url      ?? existing.map_url      ?? '',
      brochure_url:  data.brochure_url ?? existing.brochure_url ?? '',
      fomo_bookings: data.fomo_bookings !== undefined ? data.fomo_bookings : existing.fomo_bookings,
      fomo_viewers:  data.fomo_viewers  !== undefined ? data.fomo_viewers  : existing.fomo_viewers,
      fomo_enabled:  data.fomo_enabled === undefined
        ? (existing.fomo_enabled ?? true)
        : Boolean(data.fomo_enabled),
      property_types: updPropTypes,
    };

    const updated = await Property.findByIdAndUpdate(req.params.id, updateData, { new: true }).lean();
    res.json({ property: normalize(updated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id/date-prices
router.get('/:id/date-prices', async (req, res) => {
  try {
    const rows = await DatePrice.find({ property_id: req.params.id })
      .sort({ date: 1 })
      .lean();
    res.json({ date_prices: rows.map(r => ({ date: r.date, price: r.price, blocked: r.blocked, note: r.note })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/:id/date-prices
router.post('/:id/date-prices', protect, adminOnly, async (req, res) => {
  const { prices } = req.body;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'prices array required' });

  try {
    const prop = await Property.findById(req.params.id).lean();
    if (!prop) return res.status(404).json({ error: 'Property not found' });

    for (const r of prices) {
      if (!r.date) continue;
      if (!r.blocked && !r.price) {
        await DatePrice.deleteOne({ property_id: req.params.id, date: r.date });
      } else {
        await DatePrice.findOneAndUpdate(
          { property_id: req.params.id, date: r.date },
          {
            property_id: req.params.id,
            date:    r.date,
            price:   r.price   || null,
            blocked: r.blocked ? true : false,
            note:    r.note    || '',
          },
          { upsert: true, new: true }
        );
      }
    }

    const updated = await DatePrice.find({ property_id: req.params.id }).sort({ date: 1 }).lean();
    res.json({ date_prices: updated.map(r => ({ date: r.date, price: r.price, blocked: r.blocked, note: r.note })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/properties/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const existing = await Property.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Property not found' });
    await Property.findByIdAndDelete(req.params.id);
    res.json({ message: 'Property deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
