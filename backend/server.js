require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app = express();

// ── Trust proxy (Railway/Vercel ke peeche hai) ────────
app.set('trust proxy', 1);

// ── Security & Middleware ─────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));  // CSP off — local dev
const allowedOrigins = [
  'null',
  /^file:/,
  /^http:\/\/localhost/,
  /^http:\/\/127\.0\.0\.1/,
  'https://staydekho.com',
  'https://www.staydekho.com',
  /\.vercel\.app$/,
];
if (process.env.FRONTEND_URL)   allowedOrigins.push(process.env.FRONTEND_URL);
if (process.env.FRONTEND_URL_2) allowedOrigins.push(process.env.FRONTEND_URL_2);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// ── Serve uploaded files (videos, images) ────────────
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Raw body for Razorpay webhook (must come before express.json)
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many requests' } }));
app.use('/api',      rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// ── Routes ───────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/bookings',   require('./routes/bookings'));
app.use('/api/payments',   require('./routes/payments'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/reels',      require('./routes/reels'));
app.use('/api/reviews',    require('./routes/reviews'));
app.use('/api/wishlist',   require('./routes/wishlist'));
app.use('/api/contact',       require('./routes/contact'));
app.use('/api/uploads',       require('./routes/uploads'));
app.use('/api/site-settings', require('./routes/settings'));
app.use('/api/ical',          require('./routes/ical'));
app.use('/api/guides',        require('./routes/guides'));
app.use('/api/addons',        require('./routes/addons'));
app.use('/api/blog',          require('./routes/blog'));

// ── Health check ─────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── 404 ──────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// ── Error handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── iCal periodic sync (every hour) ───────────────────
// Pulls all configured ical_sources and updates blocked dates.
// Disable by setting ICAL_SYNC_DISABLED=1.
if (process.env.ICAL_SYNC_DISABLED !== '1') {
  const axios = require('axios');
  const db    = require('./db/database');
  const { parseCalendar } = require('./services/ical');

  async function runIcalSync() {
    try {
      const sources = db.prepare('SELECT * FROM ical_sources').all();
      const upsert = db.prepare(`
        INSERT INTO ical_blocks (property_id, source, external_uid, summary, start_date, end_date, synced_at)
        VALUES (?, 'external', ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(property_id, external_uid) DO UPDATE SET
          summary=excluded.summary, start_date=excluded.start_date,
          end_date=excluded.end_date, synced_at=excluded.synced_at
      `);
      for (const src of sources) {
        try {
          const r = await axios.get(src.url, { timeout: 15000, responseType: 'text' });
          const events = parseCalendar(r.data || '');
          const tx = db.transaction((rows) => {
            for (const ev of rows) {
              if (!ev.uid || !ev.start || !ev.end) continue;
              upsert.run(src.property_id, ev.uid, ev.summary || '', ev.start, ev.end);
            }
          });
          tx(events);
          db.prepare('UPDATE ical_sources SET last_synced = datetime(\'now\'), last_error = NULL WHERE id = ?').run(src.id);
        } catch (e) {
          const msg = e.response?.status ? `HTTP ${e.response.status}` : e.message;
          db.prepare('UPDATE ical_sources SET last_error = ? WHERE id = ?').run(msg, src.id);
        }
      }
    } catch (e) { console.error('iCal sync tick error:', e.message); }
  }
  const intervalMs = Number(process.env.ICAL_SYNC_INTERVAL_MS) || (60 * 60 * 1000);
  setTimeout(runIcalSync, 30 * 1000);          // first tick 30s after boot
  setInterval(runIcalSync, intervalMs);
}

// ── Start ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 StayDekho Backend running on http://localhost:${PORT}`);
  console.log(`📋 API Docs:`);
  console.log(`   POST /api/auth/register`);
  console.log(`   POST /api/auth/login`);
  console.log(`   GET  /api/properties`);
  console.log(`   POST /api/bookings`);
  console.log(`   POST /api/payments/create-order`);
  console.log(`   POST /api/payments/verify`);
  console.log(`   GET  /api/admin/stats\n`);
});
