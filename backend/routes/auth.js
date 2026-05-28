const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { User, OTP } = require('../db/models');
const { protect } = require('../middleware/auth');
const { sendOtpSMS } = require('../services/sms');

function signToken(id) {
  // No expiresIn = token never expires
  return jwt.sign({ id }, process.env.JWT_SECRET);
}

function cleanPhone(phone) {
  return String(phone).replace(/\D/g, '').slice(-10); // last 10 digits
}

// Indian mobile: 10 digits, starting with 6/7/8/9 (per TRAI spec)
function isValidIndianMobile(ph) {
  return /^[6-9]\d{9}$/.test(ph);
}

// ── OTP: Send ─────────────────────────────────────────────
// POST /api/auth/send-otp   body: { phone }
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const ph = cleanPhone(phone);
  if (!isValidIndianMobile(ph))
    return res.status(400).json({ error: 'Enter a valid +91 Indian mobile number (10 digits, starting with 6-9)' });

  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await OTP.deleteMany({ phone: ph });
    await OTP.create({
      phone: ph,
      otp,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      used: false,
    });

    try {
      await sendOtpSMS(ph, otp);
    } catch (err) {
      console.error('MSG91 SMS error:', err.response?.data || err.message);
      return res.status(500).json({ error: 'SMS bhejne mein problem aayi. Thodi der baad try karo.' });
    }

    res.json({ message: 'OTP sent successfully', expires_in: 600 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OTP: Verify & Login ────────────────────────────────────
// POST /api/auth/verify-otp  body: { phone, otp, name? }
router.post('/verify-otp', async (req, res) => {
  const { phone, otp, name } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

  const ph = cleanPhone(phone);

  try {
    const record = await OTP.findOne({ phone: ph, used: false }).sort({ _id: -1 });

    if (!record)
      return res.status(400).json({ error: 'OTP not found. Please request a new one.' });

    if (record.expires_at < new Date()) {
      await OTP.deleteMany({ phone: ph });
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (record.otp !== String(otp))
      return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });

    // Mark OTP used
    await OTP.findByIdAndUpdate(record._id, { used: true });

    // Find or auto-create user
    let user = await User.findOne({ phone: ph }).lean();
    const isNew = !user;

    if (isNew) {
      const userName  = (name && name.trim()) || `User${ph.slice(-4)}`;
      const dummyEmail = `${ph}@otp.staydekho.com`;
      const dummyPass  = bcrypt.hashSync(Math.random().toString(36) + Date.now(), 6);
      const created = await User.create({ name: userName, email: dummyEmail, phone: ph, password: dummyPass });
      user = created.toObject();
      console.log(`✅ New user registered via OTP: ${userName} (+91-${ph})`);
    }

    const { password: _, ...safeUser } = user;
    res.json({ token: signToken(user._id.toString()), user: safeUser, is_new: isNew });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Email / Password Login ─────────────────────────────────
// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid email or password' });

    const { password: _, ...safeUser } = user;
    res.json({ token: signToken(user._id.toString()), user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Register ───────────────────────────────────────────────
// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const exists = await User.findOne({ email: email.toLowerCase() }).lean();
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const hash = bcrypt.hashSync(password, 10);
    const created = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      phone: phone || null,
      password: hash,
    });

    const { password: _, ...safeUser } = created.toObject();
    res.status(201).json({ token: signToken(created._id.toString()), user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Me ────────────────────────────────────────────────────
// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const full = await User.findById(req.user.id).select('-password').lean();
    res.json({ user: full || req.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/me  — update profile
router.put('/me', protect, async (req, res) => {
  const { name, phone, avatar_url } = req.body;
  try {
    const updated = await User.findByIdAndUpdate(
      req.user.id,
      {
        name:       name       || req.user.name,
        phone:      phone      || req.user.phone,
        avatar_url: avatar_url !== undefined ? avatar_url : (req.user.avatar_url || ''),
      },
      { new: true }
    ).select('-password').lean();
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Google Client ID (public) ─────────────────────────
router.get('/google-client-id', (req, res) => {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id || id.includes('your_google')) return res.json({ client_id: null });
  res.json({ client_id: id });
});

// ── Forgot Password: Send OTP ─────────────────────────
// POST /api/auth/forgot-password   body: { phone }
router.post('/forgot-password', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  const ph = cleanPhone(phone);
  if (!isValidIndianMobile(ph))
    return res.status(400).json({ error: 'Enter a valid +91 Indian mobile number (10 digits, starting with 6-9)' });

  try {
    const user = await User.findOne({ phone: ph }).lean();
    if (!user) return res.status(404).json({ error: 'No account found with this phone number' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await OTP.deleteMany({ phone: ph });
    await OTP.create({
      phone: ph,
      otp,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      used: false,
    });

    try {
      await sendOtpSMS(ph, otp);
    } catch (err) {
      console.error('Forgot password SMS error:', err.message);
      return res.status(500).json({ error: 'SMS send karne mein problem aayi.' });
    }

    res.json({ message: 'OTP sent', expires_in: 600 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reset Password ────────────────────────────────────
// POST /api/auth/reset-password   body: { phone, otp, password }
router.post('/reset-password', async (req, res) => {
  const { phone, otp, password } = req.body;
  if (!phone || !otp || !password)
    return res.status(400).json({ error: 'Phone, OTP aur new password required hain' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password at least 6 characters ka hona chahiye' });

  const ph = cleanPhone(phone);

  try {
    const record = await OTP.findOne({ phone: ph, used: false }).sort({ _id: -1 });

    if (!record) return res.status(400).json({ error: 'OTP nahi mila. Pehle forgot password request karo.' });
    if (record.expires_at < new Date()) {
      await OTP.deleteMany({ phone: ph });
      return res.status(400).json({ error: 'OTP expired. Dobara try karo.' });
    }
    if (record.otp !== String(otp)) return res.status(400).json({ error: 'Galat OTP.' });

    await OTP.findByIdAndUpdate(record._id, { used: true });
    const hash = bcrypt.hashSync(password, 10);
    await User.findOneAndUpdate({ phone: ph }, { password: hash });

    res.json({ message: 'Password successfully reset! Ab login karo.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Google OAuth ──────────────────────────────────────
// POST /api/auth/google   body: { credential }  (Google ID token)
router.post('/google', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(501).json({ error: 'Google login not configured' });

  try {
    const { OAuth2Client } = require('google-auth-library');
    const client  = new OAuth2Client(clientId);
    const ticket  = await client.verifyIdToken({ idToken: req.body.credential, audience: clientId });
    const payload = ticket.getPayload();

    const email = payload.email.toLowerCase();
    const name  = payload.name || email.split('@')[0];

    let user = await User.findOne({ email }).lean();
    if (!user) {
      const dummyPass = bcrypt.hashSync(Math.random().toString(36) + Date.now(), 6);
      const created = await User.create({ name, email, phone: null, password: dummyPass });
      user = created.toObject();
    }

    const { password: _, ...safeUser } = user;
    res.json({ token: signToken(user._id.toString()), user: safeUser });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Google verification failed' });
  }
});

module.exports = router;
