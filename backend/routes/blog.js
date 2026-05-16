const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { BlogPost, User } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// GET /api/blog  — list posts (admin sees all, public sees published only)
router.get('/', async (req, res) => {
  const { category } = req.query;
  try {
    // Check if admin via JWT header
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token   = authHeader.split(' ')[1];
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const u = await User.findById(payload.id).select('role').lean();
        isAdmin = u?.role === 'admin';
      } catch { /* not admin */ }
    }

    const filter = {};
    if (!isAdmin) filter.published = true;
    if (category && category !== 'all') filter.category = category;

    const posts = await BlogPost.find(filter)
      .sort({ published_at: -1, created_at: -1 })
      .lean();

    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/blog/:slug
router.get('/:slug', async (req, res) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug }).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (!post.published) {
      // Only admin can see unpublished posts
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(404).json({ error: 'Post not found' });
      try {
        const payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const u = await User.findById(payload.id).select('role').lean();
        if (u?.role !== 'admin') return res.status(404).json({ error: 'Post not found' });
      } catch {
        return res.status(404).json({ error: 'Post not found' });
      }
    }

    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/blog  — admin: create post
router.post('/', protect, adminOnly, async (req, res) => {
  const { title, excerpt, body, category, cover_image, author, published } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  try {
    let slug = slugify(title);
    // Ensure unique slug
    const existing = await BlogPost.findOne({ slug }).lean();
    if (existing) slug = slug + '-' + Date.now();

    const pub = published === true || published === 1 ? true : false;

    const post = await BlogPost.create({
      title:        title.trim(),
      slug,
      excerpt:      excerpt     || '',
      body,
      category:     category    || 'General',
      cover_image:  cover_image || '',
      author:       author      || 'StayDekho Team',
      published:    pub,
      published_at: pub ? new Date() : null,
    });

    res.status(201).json({ post: post.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/blog/:id  — admin: update post
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const existing = await BlogPost.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found' });

    const { title, excerpt, body, category, cover_image, author, published } = req.body;
    const pub = published === true || published === 1 ? true : false;
    const publishedAt = pub && !existing.published_at ? new Date() : existing.published_at;

    let slug = existing.slug;
    if (title && title.trim() !== existing.title) {
      slug = slugify(title);
      const conflict = await BlogPost.findOne({ slug, _id: { $ne: req.params.id } }).lean();
      if (conflict) slug = slug + '-' + Date.now();
    }

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      {
        title:        title       ?? existing.title,
        slug,
        excerpt:      excerpt     ?? existing.excerpt,
        body:         body        ?? existing.body,
        category:     category    ?? existing.category,
        cover_image:  cover_image ?? existing.cover_image,
        author:       author      ?? existing.author,
        published:    pub,
        published_at: publishedAt,
      },
      { new: true }
    ).lean();

    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/blog/:id  — admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const existing = await BlogPost.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    await BlogPost.findByIdAndDelete(req.params.id);
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
