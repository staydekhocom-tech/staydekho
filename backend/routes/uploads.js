const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const db     = require('../db/database');
const { protect, adminOnly } = require('../middleware/auth');

const imgDir = path.join(__dirname, '..', 'uploads', 'images');
const docDir = path.join(__dirname, '..', 'uploads', 'brochures');
const avDir  = path.join(__dirname, '..', 'uploads', 'avatars');
[imgDir, docDir, avDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function diskStore(dir, prefix) {
  return multer.diskStorage({
    destination: (_, __, cb) => cb(null, dir),
    filename:    (_, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      cb(null, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`);
    },
  });
}

const imageUpload = multer({
  storage: diskStore(imgDir, 'img'),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only image files allowed (jpg, png, webp)'));
  },
});

const brochureUpload = multer({
  storage: diskStore(docDir, 'pdf'),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  },
});

const avatarUpload = multer({
  storage: diskStore(avDir, 'av'),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only jpg/png/webp allowed'));
  },
});

function publicUrl(req, sub, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${sub}/${filename}`;
}

// POST /api/uploads/image  — admin/general image upload
router.post('/image', protect, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: publicUrl(req, 'images', req.file.filename) });
});

// POST /api/uploads/brochure/:propertyId  — admin, attaches PDF to property
router.post('/brochure/:propertyId', protect, adminOnly, brochureUpload.single('brochure'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
  const url = publicUrl(req, 'brochures', req.file.filename);
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  db.prepare('UPDATE properties SET brochure_url = ? WHERE id = ?').run(url, prop.id);
  res.json({ url });
});

// POST /api/uploads/avatar  — current user updates own profile picture
router.post('/avatar', protect, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = publicUrl(req, 'avatars', req.file.filename);
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(url, req.user.id);
  res.json({ url });
});

module.exports = router;
