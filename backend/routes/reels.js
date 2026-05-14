const router = require('express').Router();
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Multer Storage ────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'reels');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 },  // 300 MB max
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp4|mov|webm|jpg|jpeg|png|webp|gif)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error('Sirf video (mp4/mov/webm) ya image (jpg/png/webp) files allowed hain'));
  },
});

const fields = upload.fields([
  { name: 'video',  maxCount: 1 },
  { name: 'poster', maxCount: 1 },
]);

function buildUrl(req, filename) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers.host;
  return `${proto}://${host}/uploads/reels/${filename}`;
}

// ── GET /api/reels  (public — homepage use karta hai) ─
router.get('/', (req, res) => {
  const reels = db
    .prepare('SELECT * FROM guest_reels WHERE active = 1 ORDER BY sort_order ASC, id ASC')
    .all();
  res.json({ reels });
});

// ── GET /api/reels/all  (admin — includes inactive) ───
router.get('/all', protect, adminOnly, (req, res) => {
  const reels = db
    .prepare('SELECT * FROM guest_reels ORDER BY sort_order ASC, id ASC')
    .all();
  res.json({ reels });
});

// ── POST /api/reels  (admin — create new reel) ────────
router.post('/', protect, adminOnly, fields, (req, res) => {
  const { name, location, stay, quote, stars, video_url, poster_url, sort_order } = req.body;
  if (!name || !stay)
    return res.status(400).json({ error: 'name aur stay required hain' });

  const vid  = req.files?.video?.[0]
    ? buildUrl(req, req.files.video[0].filename)
    : (video_url  || '');
  const post = req.files?.poster?.[0]
    ? buildUrl(req, req.files.poster[0].filename)
    : (poster_url || '');

  const result = db.prepare(`
    INSERT INTO guest_reels (name, location, stay, quote, stars, video_url, poster_url, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(name, location || '', stay, quote || '', parseInt(stars) || 5,
         vid, post, parseInt(sort_order) || 0);

  const reel = db.prepare('SELECT * FROM guest_reels WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ reel });
});

// ── PUT /api/reels/:id  (admin — update reel) ─────────
router.put('/:id', protect, adminOnly, fields, (req, res) => {
  const existing = db.prepare('SELECT * FROM guest_reels WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reel nahi mila' });

  const { name, location, stay, quote, stars, video_url, poster_url, sort_order, active } = req.body;

  const vid  = req.files?.video?.[0]
    ? buildUrl(req, req.files.video[0].filename)
    : (video_url  !== undefined ? video_url  : existing.video_url);
  const post = req.files?.poster?.[0]
    ? buildUrl(req, req.files.poster[0].filename)
    : (poster_url !== undefined ? poster_url : existing.poster_url);

  db.prepare(`
    UPDATE guest_reels
    SET name=?, location=?, stay=?, quote=?, stars=?, video_url=?, poster_url=?,
        sort_order=?, active=?
    WHERE id=?
  `).run(
    name      || existing.name,
    location  !== undefined ? location  : existing.location,
    stay      || existing.stay,
    quote     !== undefined ? quote     : existing.quote,
    parseInt(stars) || existing.stars,
    vid, post,
    parseInt(sort_order) >= 0 ? parseInt(sort_order) : existing.sort_order,
    active    !== undefined ? (active === '1' || active === true || active === 1 ? 1 : 0) : existing.active,
    req.params.id,
  );

  const reel = db.prepare('SELECT * FROM guest_reels WHERE id = ?').get(req.params.id);
  res.json({ reel });
});

// ── DELETE /api/reels/:id  (admin) ────────────────────
router.delete('/:id', protect, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM guest_reels WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reel nahi mila' });
  db.prepare('DELETE FROM guest_reels WHERE id = ?').run(req.params.id);
  res.json({ message: 'Reel delete ho gayi' });
});

module.exports = router;
