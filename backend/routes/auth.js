const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/database');
const { protect } = require('../middleware/auth');
const { sendOtpSMS } = require('../services/sms');

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
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

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  db.prepare('DELETE FROM otps WHERE phone = ?').run(ph);
  db.prepare('INSERT INTO otps (phone, otp, expires_at) VALUES (?, ?, ?)').run(ph, otp, expiresAt);

  try {
    await sendOtpSMS(ph, otp);
  } catch (err) {
    console.error('MSG91 SMS error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'SMS bhejne mein problem aayi. Thodi der baad try karo.' });
  }

  res.json({
    message: 'OTP sent successfully',
    expires_in: 600,
  });
});

// ── OTP: Verify & Login ────────────────────────────────────
// POST /api/auth/verify-otp  body: { phone, otp, name? }
router.post('/verify-otp', (req, res) => {
  const { phone, otp, name } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

  const ph = cleanPhone(phone);

  const record = db.prepare(
    'SELECT * FROM otps WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(ph);

  if (!record)
    return res.status(400).json({ error: 'OTP not found. Please request a new one.' });

  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM otps WHERE phone = ?').run(ph);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  if (record.otp !== String(otp))
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });

  // Mark OTP used
  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(record.id);

  // Find or auto-create user
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(ph);
  const isNew = !user;

  if (isNew) {
    const userName = (name && name.trim()) || `User${ph.slice(-4)}`;
    const dummyEmail = `${ph}@otp.staydekho.com`;
    const dummyPass  = bcrypt.hashSync(Math.random().toString(36) + Date.now(), 6);
    const result = db.prepare(
      'INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)'
    ).run(userName, dummyEmail, ph, dummyPass);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    console.log(`✅ New user registered via OTP: ${userName} (+91-${ph})`);
  }

  const { password: _, ...safeUser } = user;
  res.json({ token: signToken(user.id), user: safeUser, is_new: isNew });
});

// ── Email / Password Login ─────────────────────────────────
// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });

  const { password: _, ...safeUser } = user;
  res.json({ token: signToken(user.id), user: safeUser });
});

// ── Register ───────────────────────────────────────────────
// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(400).json({ error: 'Email already registered' });

  const hash   = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), email.toLowerCase(), phone || null, hash);

  const user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: signToken(user.id), user });
});

// ── Me ────────────────────────────────────────────────────
// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  const full = db.prepare('SELECT id, name, email, phone, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: full || req.user });
});

// PUT /api/auth/me  — update profile
router.put('/me', protect, (req, res) => {
  const { name, phone, avatar_url } = req.body;
  db.prepare('UPDATE users SET name = ?, phone = ?, avatar_url = ? WHERE id = ?')
    .run(name || req.user.name, phone || req.user.phone,
         avatar_url !== undefined ? avatar_url : (req.user.avatar_url || ''),
         req.user.id);
  const updated = db.prepare('SELECT id, name, email, phone, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
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

  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(ph);
  if (!user) return res.status(404).json({ error: 'No account found with this phone number' });

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare('DELETE FROM otps WHERE phone = ?').run(ph);
  db.prepare('INSERT INTO otps (phone, otp, expires_at) VALUES (?, ?, ?)').run(ph, otp, expiresAt);

  try {
    await sendOtpSMS(ph, otp);
  } catch (err) {
    console.error('Forgot password SMS error:', err.message);
    return res.status(500).json({ error: 'SMS send karne mein problem aayi.' });
  }

  res.json({ message: 'OTP sent', expires_in: 600 });
});

// ── Reset Password ────────────────────────────────────
// POST /api/auth/reset-password   body: { phone, otp, password }
router.post('/reset-password', (req, res) => {
  const { phone, otp, password } = req.body;
  if (!phone || !otp || !password)
    return res.status(400).json({ error: 'Phone, OTP aur new password required hain' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password at least 6 characters ka hona chahiye' });

  const ph = cleanPhone(phone);
  const record = db.prepare('SELECT * FROM otps WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(ph);

  if (!record) return res.status(400).json({ error: 'OTP nahi mila. Pehle forgot password request karo.' });
  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM otps WHERE phone = ?').run(ph);
    return res.status(400).json({ error: 'OTP expired. Dobara try karo.' });
  }
  if (record.otp !== String(otp)) return res.status(400).json({ error: 'Galat OTP.' });

  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(record.id);
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE phone = ?').run(hash, ph);

  res.json({ message: 'Password successfully reset! Ab login karo.' });
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

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      const dummyPass = bcrypt.hashSync(Math.random().toString(36) + Date.now(), 6);
      const result = db.prepare('INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)')
        .run(name, email, null, dummyPass);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    const { password: _, ...safeUser } = user;
    res.json({ token: signToken(user.id), user: safeUser });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Google verification failed' });
  }
});

module.exports = router;
