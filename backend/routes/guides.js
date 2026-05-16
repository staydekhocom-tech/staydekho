const router = require('express').Router();
const { TravelGuide } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/guides  — public list
router.get('/', async (_req, res) => {
  try {
    const guides = await TravelGuide.find({ published: true })
      .select('-body')
      .sort({ created_at: -1 })
      .lean();
    res.json({ guides });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/guides/:slug  — public single
router.get('/:slug', async (req, res) => {
  try {
    const guide = await TravelGuide.findOne({ slug: req.params.slug, published: true }).lean();
    if (!guide) return res.status(404).json({ error: 'Guide not found' });
    res.json({ guide });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guides  — admin
router.post('/', protect, adminOnly, async (req, res) => {
  const { city, title, summary, body, hero_image, published } = req.body;
  if (!city || !title) return res.status(400).json({ error: 'city and title required' });

  const slug = slugify(`${city}-${title}`);
  try {
    const guide = await TravelGuide.create({
      slug,
      city,
      title,
      summary:    summary    || '',
      body:       body       || '',
      hero_image: hero_image || '',
      published:  published === false ? false : true,
    });
    res.status(201).json({ guide: guide.toObject() });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'A guide with that city/title already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/guides/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const existing = await TravelGuide.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Guide not found' });

    const { city, title, summary, body, hero_image, published } = req.body;

    const guide = await TravelGuide.findByIdAndUpdate(
      req.params.id,
      {
        city:       city       || existing.city,
        title:      title      || existing.title,
        summary:    summary    ?? existing.summary,
        body:       body       ?? existing.body,
        hero_image: hero_image ?? existing.hero_image,
        published:  published === undefined ? existing.published : Boolean(published),
      },
      { new: true }
    ).lean();

    res.json({ guide });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/guides/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await TravelGuide.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
