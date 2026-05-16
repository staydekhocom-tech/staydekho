const router = require('express').Router();
const { Wishlist } = require('../db/models');
const { protect } = require('../middleware/auth');

// GET /api/wishlist — user ki wishlist (full property docs)
router.get('/', protect, async (req, res) => {
  try {
    const docs = await Wishlist.find({ user_id: req.user.id })
      .populate('property_id')
      .sort({ created_at: -1 })
      .lean();
    const properties = docs
      .filter(w => w.property_id)
      .map(w => w.property_id);
    res.json({ properties });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wishlist/ids — sirf IDs (quick check ke liye)
router.get('/ids', protect, async (req, res) => {
  try {
    const docs = await Wishlist.find({ user_id: req.user.id }, 'property_id').lean();
    res.json({ ids: docs.map(r => r.property_id.toString()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wishlist/:id — add
router.post('/:id', protect, async (req, res) => {
  try {
    await Wishlist.findOneAndUpdate(
      { user_id: req.user.id, property_id: req.params.id },
      { user_id: req.user.id, property_id: req.params.id },
      { upsert: true, new: true }
    );
    res.json({ wishlisted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/wishlist/:id — remove
router.delete('/:id', protect, async (req, res) => {
  try {
    await Wishlist.deleteOne({ user_id: req.user.id, property_id: req.params.id });
    res.json({ wishlisted: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
