const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { Property, User } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');

// ── Cloudinary (for multi-image property upload) ─────
let cloudinary = null;
try {
  const { v2: cld } = require('cloudinary');
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name') {
    cld.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
    cloudinary = cld;
  }
} catch(e) { /* cloudinary not installed — local fallback used */ }

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'staydekho/properties', resource_type: 'image',
        transformation: [{ width: 1400, height: 900, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }] },
      (err, result) => err ? reject(err) : resolve(result.secure_url)
    );
    stream.end(buffer);
  });
}

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

// POST /api/uploads/image  — single image upload
router.post('/image', protect, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: publicUrl(req, 'images', req.file.filename) });
});

// POST /api/uploads/images  — multiple images (max 40) → Cloudinary or local
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => { const ok = ['.jpg','.jpeg','.png','.webp','.avif']; ok.includes(path.extname(file.originalname).toLowerCase()) ? cb(null,true) : cb(new Error('Only image files allowed')); }
});
router.post('/images', protect, adminOnly, memUpload.array('images', 70), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Koi file nahi mili' });
  try {
    let urls;
    if (cloudinary) {
      urls = await Promise.all(req.files.map(f => uploadToCloudinary(f.buffer)));
    } else {
      urls = req.files.map(file => {
        const ext  = path.extname(file.originalname).toLowerCase();
        const name = `img_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`;
        fs.writeFileSync(path.join(imgDir, name), file.buffer);
        return publicUrl(req, 'images', name);
      });
    }
    res.json({ urls, count: urls.length });
  } catch (err) {
    console.error('Multi-upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// POST /api/uploads/brochure/:propertyId  — admin, attaches PDF to property
router.post('/brochure/:propertyId', protect, adminOnly, brochureUpload.single('brochure'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
  try {
    const prop = await Property.findById(req.params.propertyId).lean();
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    const url = publicUrl(req, 'brochures', req.file.filename);
    await Property.findByIdAndUpdate(req.params.propertyId, { brochure_url: url });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/uploads/avatar  — current user updates own profile picture
router.post('/avatar', protect, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const url = publicUrl(req, 'avatars', req.file.filename);
    await User.findByIdAndUpdate(req.user.id, { avatar_url: url });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
