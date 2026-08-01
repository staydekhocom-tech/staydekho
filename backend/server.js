// Polyfill global crypto (required by MongoDB driver on some Node versions)
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

// ── MongoDB Connect ───────────────────────────────────
const { connectDB } = require('./db/mongodb');

const app = express();

// ── Trust proxy (Railway/Vercel ke peeche hai) ────────
app.set('trust proxy', 1);

// ── Security & Middleware ─────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
const allowedOrigins = [
  'null', /^file:/, /^http:\/\/localhost/, /^http:\/\/127\.0\.0\.1/,
  'https://staydekho.com', 'https://www.staydekho.com', /\.vercel\.app$/,
];
if (process.env.FRONTEND_URL)   allowedOrigins.push(process.env.FRONTEND_URL);
if (process.env.FRONTEND_URL_2) allowedOrigins.push(process.env.FRONTEND_URL_2);

app.use(cors({ origin: allowedOrigins, credentials: true }));

// ── Serve uploaded files ──────────────────────────────
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Raw body for Razorpay webhook
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many requests' } }));
app.use('/api',      rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// ── Routes ───────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/properties',    require('./routes/properties'));
app.use('/api/bookings',      require('./routes/bookings'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/reels',         require('./routes/reels'));
app.use('/api/reviews',       require('./routes/reviews'));
app.use('/api/wishlist',      require('./routes/wishlist'));
app.use('/api/contact',       require('./routes/contact'));
app.use('/api/uploads',       require('./routes/uploads'));
app.use('/api/site-settings', require('./routes/settings'));
app.use('/api/ical',          require('./routes/ical'));
app.use('/api/guides',        require('./routes/guides'));
app.use('/api/addons',        require('./routes/addons'));
app.use('/api/blog',          require('./routes/blog'));
app.use('/api/operations',    require('./routes/operations'));
app.use('/api/staff',         require('./routes/staff'));
app.use('/api/checkin',       require('./routes/checkin'));

// ── Health check ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({
    status: 'ok',
    time:   new Date().toISOString(),
    db:     mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// ── Error handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── iCal periodic sync (MongoDB version) ─────────────
if (process.env.ICAL_SYNC_DISABLED !== '1') {
  const axios = require('axios');
  const { IcalSource, IcalBlock } = require('./db/models');
  const { parseCalendar } = require('./services/ical');

  async function runIcalSync() {
    try {
      const sources = await IcalSource.find().lean();
      for (const src of sources) {
        try {
          const r = await axios.get(src.url, { timeout: 15000, responseType: 'text' });
          const events = parseCalendar(r.data || '');
          for (const ev of events) {
            if (!ev.uid || !ev.start || !ev.end) continue;
            await IcalBlock.findOneAndUpdate(
              { property_id: src.property_id, external_uid: ev.uid },
              { source: 'external', summary: ev.summary || '', start_date: ev.start, end_date: ev.end, synced_at: new Date() },
              { upsert: true }
            );
          }
          await IcalSource.findByIdAndUpdate(src._id, { last_synced: new Date(), last_error: null });
        } catch (e) {
          const msg = e.response?.status ? `HTTP ${e.response.status}` : e.message;
          await IcalSource.findByIdAndUpdate(src._id, { last_error: msg });
        }
      }
    } catch (e) { console.error('iCal sync error:', e.message); }
  }

  const intervalMs = Number(process.env.ICAL_SYNC_INTERVAL_MS) || (20 * 60 * 1000); // default 20 min
  setTimeout(runIcalSync, 30 * 1000);
  setInterval(runIcalSync, intervalMs);
}

// ── Auto check-in / check-out by date (IST) ───────────
// confirmed + checkin aa gaya  → checked_in
// checked_in/confirmed + checkout aa gaya → checked_out
async function runAutoStatusUpdate() {
  try {
    const { Booking } = require('./db/models');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

    const rIn = await Booking.updateMany(
      { status: 'confirmed', checkin: { $lte: today }, checkout: { $gt: today } },
      { $set: { status: 'checked_in' } }
    );
    const rOut = await Booking.updateMany(
      { status: { $in: ['confirmed', 'checked_in'] }, checkout: { $lte: today } },
      { $set: { status: 'checked_out' } }
    );
    if (rIn.modifiedCount || rOut.modifiedCount) {
      console.log(`🔄 Auto-status: ${rIn.modifiedCount} checked-in, ${rOut.modifiedCount} checked-out (${today})`);
    }
  } catch (e) { console.error('Auto-status error:', e.message); }
}
setTimeout(runAutoStatusUpdate, 15 * 1000);           // startup ke 15s baad
setInterval(runAutoStatusUpdate, 60 * 60 * 1000);     // phir har ghante

// ── Start (MongoDB connect karke phir listen) ─────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 StayDekho Backend running on http://localhost:${PORT}`);
    console.log(`🍃 Database: MongoDB Atlas`);
    console.log(`📋 Routes: /api/auth, /api/properties, /api/bookings, /api/payments, /api/admin\n`);
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
