# StayDekho Website — Project Context

Group-stay villa/homestay booking platform, Udaipur, Rajasthan. Read this file at the start of any new session so you don't have to re-derive it from chat history.

## Architecture
- **Frontend**: static HTML/CSS/JS, deployed on **Vercel** — `www.staydekho.com`
- **Backend**: Node/Express, deployed on **Railway** — `api.staydekho.com`
- **DB**: MongoDB Atlas (Mongoose models in `backend/db/models.js`)
- **Images**: Cloudinary, cloud name `dmmhsr4e7`, via shared `cldUrl()` helper
- **Admin panel**: `admin.html` — single-page app, tab-based (`showPage(name)` switches `.page-view` divs), calls backend through `js/api.js`'s `api.*` methods
- Git: commits pushed directly to `main` (no PR flow for this repo), Railway/Vercel auto-deploy on push

## Key backend files
- `backend/db/models.js` — all Mongoose schemas, exported at the bottom
- `backend/routes/bookings.js` — admin-authenticated booking CRUD + Proforma/Tax Invoice (`/api/bookings/:id/invoice`) + Owner Payout Statement (`/api/bookings/:id/owner-bill`)
- `backend/routes/invoice.js` — **public, no-auth** twins of the above, used in WhatsApp links: `/invoice/:id` (guest) and `/payout/:id` (owner). Mounted at `/` (not `/api`) in `server.js`.
- `backend/routes/operations.js` — bookings-log (the Add/Edit Booking admin form backs onto this), expenses, cleaning, payout summary
- `backend/services/whatsapp.js` — all outbound WhatsApp Cloud API sends (Meta Graph API v19.0), branches by `booking.platform`
- `backend/routes/whatsappWebhook.js` — Meta's delivery-status webhook for the MAIN WABA (self-managed)
- `backend/routes/interakt.js` — inbound webhook + admin inbox APIs for the SECOND WABA (Interakt-managed, +91 87692 22983)
- `backend/server.js` — route mounting, middleware order

## Business formulas (do not "simplify" without re-reading this)
- **Owner payout (OTA bookings)**: `ownerShare = Math.round((net_payout − remitted_tax) × 0.70)`
  - `net_payout` = RAW amount the OTA platform transfers (admin enters it pre-tax, on purpose)
  - `remitted_tax` = occupancy tax the OTA already remitted to govt on our behalf
  - The **public** owner-payout bill (`invoice.js /payout/:id`) must show only the final net-of-tax "Net Payout" figure and "Your Payout" — **never a tax line or the exact 70/30 split %** (forwarded link, no auth, shouldn't expose commission structure or tax mechanics)
  - The **admin-authenticated** owner-bill (`bookings.js /owner-bill`) CAN show the full breakdown including StayDekho's 30% share — that view is internal-only
- Direct/walk-in bookings: no platform deduction, split is on full guest-paid amount

## WhatsApp — two separate WABAs
1. **Main WABA** (self-managed, ID 3054997438040048) — payment method: MasterCard. Sends booking confirmations, invoices, payouts via `services/whatsapp.js`.
2. **Interakt-managed WABA** (+91 87692 22983, ID 1523541902725069) — Interakt is the BSP; needs `INTERAKT_API_KEY` env var + a webhook configured in Interakt's own dashboard pointing to `https://api.staydekho.com/api/interakt/webhook`. Used for the admin "WhatsApp Inbox" (`admin.html` → sidebar → 💬 WhatsApp Inbox) to view/reply to inbound leads without opening Interakt's dashboard.
3. OTA (Airbnb/Booking.com/etc.) booking confirmations need a separate Meta-approved template `staydekho_booking_confirmed_ota` (NOT YET CREATED as of 2026-10 — code in `whatsapp.js` will silently no-op until it exists) because Advance/Balance wording doesn't apply to OTA bookings (guest pays the platform, not us).

## SEO
- Per-page meta/titles, JSON-LD (LodgingBusiness/FAQPage/TouristDestination), `sitemap-static.xml`, canonical tags already done for main pages
- Pattern for new SEO landing pages: static HTML page (not the dynamic `/travel-guide.html` system), e.g. `udaipur-private-pool-villas.html`, `udaipur-travel-guide.html` — add to `sitemap-static.xml` + internal links from `index.html` footer

## Known pending items
- `staydekho_booking_confirmed_ota` WhatsApp template — needs creation/approval in Meta Business Manager (user's task, not code)
- PDF-as-WhatsApp-attachment for invoices — explained, not built; needs Puppeteer PDF gen + new Meta "Document Header" template
- Udaipur travel guide rental section — deferred, add later
- 11 properties with thin/missing descriptions — user needs to write these

## Working conventions
- User (Sanskar) writes in Hinglish — respond in Hinglish for chat, English for code/comments
- No comments explaining WHAT code does; only WHY when non-obvious
- Verify financial/calculation changes against the system's own documented formula (e.g., admin.html's Add Booking modal help-text) before generalizing from one example
- This repo is not a git repository with PR flow — direct commits to `main`, confirm before pushing
