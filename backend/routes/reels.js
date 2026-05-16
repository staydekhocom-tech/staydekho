const router   = require('express').Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { GuestReel } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

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
router.get('/', async (req, res) => {
  try {
    const reels = await GuestReel.find({ active: true })
      .sort({ sort_order: 1, _id: 1 })
      .lean();
    res.json({ reels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reels/all  (admin — includes inactive) ───
router.get('/all', protect, adminOnly, async (req, res) => {
  try {
    const reels = await GuestReel.find()
      .sort({ sort_order: 1, _id: 1 })
      .lean();
    res.json({ reels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reels  (admin — create new reel) ────────
router.post('/', protect, adminOnly, fields, async (req, res) => {
  const { name, location, stay, quote, stars, video_url, poster_url, sort_order } = req.body;
  if (!name || !stay)
    return res.status(400).json({ error: 'name aur stay required hain' });

  try {
    const vid  = req.files?.video?.[0]
      ? buildUrl(req, req.files.video[0].filename)
      : (video_url  || '');
    const post = req.files?.poster?.[0]
      ? buildUrl(req, req.files.poster[0].filename)
      : (poster_url || '');

    const reel = await GuestReel.create({
      name,
      location:   location   || '',
      stay,
      quote:      quote      || '',
      stars:      parseInt(stars) || 5,
      video_url:  vid,
      poster_url: post,
      sort_order: parseInt(sort_order) || 0,
      active:     true,
    });

    res.status(201).json({ reel: reel.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/reels/:id  (admin — update reel) ─────────
router.put('/:id', protect, adminOnly, fields, async (req, res) => {
  try {
    const existing = await GuestReel.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Reel nahi mila' });

    const { name, location, stay, quote, stars, video_url, poster_url, sort_order, active } = req.body;

    const vid  = req.files?.video?.[0]
      ? buildUrl(req, req.files.video[0].filename)
      : (video_url  !== undefined ? video_url  : existing.video_url);
    const post = req.files?.poster?.[0]
      ? buildUrl(req, req.files.poster[0].filename)
      : (poster_url !== undefined ? poster_url : existing.poster_url);

    const updateData = {
      name:       name     || existing.name,
      location:   location !== undefined ? location  : existing.location,
      stay:       stay     || existing.stay,
      quote:      quote    !== undefined ? quote     : existing.quote,
      stars:      parseInt(stars) || existing.stars,
      video_url:  vid,
      poster_url: post,
      sort_order: parseInt(sort_order) >= 0 ? parseInt(sort_order) : existing.sort_order,
      active:     active !== undefined
        ? (active === '1' || active === true || active === 1 ? true : false)
        : existing.active,
    };

    const reel = await GuestReel.findByIdAndUpdate(req.params.id, updateData, { new: true }).lean();
    res.json({ reel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/reels/:id  (admin) ────────────────────
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const existing = await GuestReel.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Reel nahi mila' });
    await GuestReel.findByIdAndDelete(req.params.id);
    res.json({ message: 'Reel delete ho gayi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
