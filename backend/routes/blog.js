const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// GET /api/blog  — list published posts (admin sees all)
router.get('/', (req, res) => {
  const { category } = req.query;
  let sql  = 'SELECT * FROM blog_posts WHERE 1=1';
  const args = [];

  // Non-admin only see published
  const isAdmin = req.headers.authorization
    ? (() => { try { const jwt = require('jsonwebtoken'); const t = req.headers.authorization.split(' ')[1]; const p = jwt.verify(t, process.env.JWT_SECRET); const u = db.prepare('SELECT role FROM users WHERE id = ?').get(p.id); return u?.role === 'admin'; } catch { return false; } })()
    : false;

  if (!isAdmin) { sql += ' AND published = 1'; }
  if (category && category !== 'all') { sql += ' AND category = ?'; args.push(category); }
  sql += ' ORDER BY published_at DESC, created_at DESC';

  const posts = db.prepare(sql).all(...args);
  res.json({ posts });
});

// GET /api/blog/:slug
router.get('/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM blog_posts WHERE slug = ?').get(req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!post.published) {
    // check if admin
    const auth = req.headers.authorization;
    if (!auth) return res.status(404).json({ error: 'Post not found' });
    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(payload.id);
      if (user?.role !== 'admin') return res.status(404).json({ error: 'Post not found' });
    } catch { return res.status(404).json({ error: 'Post not found' }); }
  }
  res.json({ post });
});

// POST /api/blog  — admin: create post
router.post('/', protect, adminOnly, (req, res) => {
  const { title, excerpt, body, category, cover_image, author, published } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  let slug = slugify(title);
  // ensure unique slug
  const existing = db.prepare('SELECT id FROM blog_posts WHERE slug = ?').get(slug);
  if (existing) slug = slug + '-' + Date.now();

  const pub = published === true || published === 1 ? 1 : 0;
  const result = db.prepare(`
    INSERT INTO blog_posts (title, slug, excerpt, body, category, cover_image, author, published, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    slug,
    excerpt || '',
    body,
    category || 'General',
    cover_image || '',
    author || 'StayDekho Team',
    pub,
    pub ? new Date().toISOString() : null
  );

  const post = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ post });
});

// PUT /api/blog/:id  — admin: update post
router.put('/:id', protect, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });

  const { title, excerpt, body, category, cover_image, author, published } = req.body;
  const pub = published === true || published === 1 ? 1 : 0;
  const publishedAt = pub && !existing.published_at ? new Date().toISOString() : existing.published_at;

  let slug = existing.slug;
  if (title && title.trim() !== existing.title) {
    slug = slugify(title);
    const conflict = db.prepare('SELECT id FROM blog_posts WHERE slug = ? AND id != ?').get(slug, req.params.id);
    if (conflict) slug = slug + '-' + Date.now();
  }

  db.prepare(`
    UPDATE blog_posts SET
      title = ?, slug = ?, excerpt = ?, body = ?, category = ?,
      cover_image = ?, author = ?, published = ?, published_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title       ?? existing.title,
    slug,
    excerpt     ?? existing.excerpt,
    body        ?? existing.body,
    category    ?? existing.category,
    cover_image ?? existing.cover_image,
    author      ?? existing.author,
    pub,
    publishedAt,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(req.params.id);
  res.json({ post: updated });
});

// DELETE /api/blog/:id  — admin
router.delete('/:id', protect, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM blog_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });
  db.prepare('DELETE FROM blog_posts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Post deleted' });
});

module.exports = router;
