const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/guides  — public list
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT id, slug, city, title, summary, hero_image, created_at FROM travel_guides WHERE published = 1 ORDER BY created_at DESC').all();
  res.json({ guides: rows });
});

// GET /api/guides/:slug  — public single
router.get('/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM travel_guides WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Guide not found' });
  res.json({ guide: row });
});

// POST /api/guides  — admin
router.post('/', protect, adminOnly, (req, res) => {
  const { city, title, summary, body, hero_image, published } = req.body;
  if (!city || !title) return res.status(400).json({ error: 'city and title required' });
  const slug = slugify(`${city}-${title}`);
  try {
    const result = db.prepare(`
      INSERT INTO travel_guides (slug, city, title, summary, body, hero_image, published)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slug, city, title, summary || '', body || '', hero_image || '', published === false ? 0 : 1);
    res.status(201).json({ guide: db.prepare('SELECT * FROM travel_guides WHERE id = ?').get(result.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'A guide with that city/title already exists' });
    throw e;
  }
});

// PUT /api/guides/:id
router.put('/:id', protect, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM travel_guides WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Guide not found' });
  const { city, title, summary, body, hero_image, published } = req.body;
  db.prepare(`
    UPDATE travel_guides SET city=?, title=?, summary=?, body=?, hero_image=?, published=? WHERE id=?
  `).run(
    city || existing.city,
    title || existing.title,
    summary ?? existing.summary,
    body ?? existing.body,
    hero_image ?? existing.hero_image,
    published === undefined ? existing.published : (published ? 1 : 0),
    req.params.id
  );
  res.json({ guide: db.prepare('SELECT * FROM travel_guides WHERE id = ?').get(req.params.id) });
});

// DELETE /api/guides/:id
router.delete('/:id', protect, adminOnly, (req, res) => {
  db.prepare('DELETE FROM travel_guides WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
