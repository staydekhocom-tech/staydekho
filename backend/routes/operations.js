const router = require('express').Router();
const { Booking, Property, Expense, CleaningTask, PlatformSetting } = require('../db/models');
const { protect, adminOnly } = require('../middleware/auth');
const {
  blockCalendarForBooking, unblockCalendarIfFree,
  createCleaningTaskForCheckout, notifyGuestBookingCreated, notifyGuestBookingCancelled,
} = require('../services/bookingAutomation');
const { notifyTeamNewBooking, notifyTeamBookingCancelled } = require('../services/whatsapp');

router.use(protect, adminOnly);

// ── Bookings Log (multi-platform — manual OTA entries) ─
// Net Payout is entered manually by the admin (no auto commission formula — too error-prone with varying OTA deals)
router.get('/bookings-log', async (req, res) => {
  try {
    const { platform, property_id } = req.query;
    const q = {};
    if (platform)    q.platform    = platform;
    if (property_id) q.property_id = property_id;
    const rows = await Booking.find(q)
      .populate('property_id', 'name location')
      .sort({ checkin: -1 })
      .lean();
    const bookings = rows.map(b => ({
      ...b,
      property_name: b.property_id?.name,
      property_id:   b.property_id?._id,
    }));
    res.json({ bookings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bookings-log', async (req, res) => {
  try {
    const {
      property_id, guest_name, guest_phone, checkin, checkout,
      platform, total_amount, advance_amount, net_payout, status, notes, balance_paid, payout_received, owner_paid,
    } = req.body;
    if (!property_id || !guest_name || !checkin || !checkout || !total_amount)
      return res.status(400).json({ error: 'Property, guest name, dates and total amount required hain' });

    // T12:00:00 avoids timezone midnight boundary off-by-one
    const cin  = new Date((checkin + '').slice(0,10) + 'T12:00:00');
    const cout = new Date((checkout + '').slice(0,10) + 'T12:00:00');
    const nights = Math.max(1, Math.round((cout - cin) / (1000 * 60 * 60 * 24)));

    // ── Double-booking check: same property, overlapping dates ──
    const overlap = await Booking.findOne({
      property_id,
      status:   { $nin: ['cancelled'] },
      checkin:  { $lt: (checkout + '').slice(0,10) },
      checkout: { $gt: (checkin  + '').slice(0,10) },
    }).lean();
    if (overlap) {
      return res.status(409).json({
        error: `⚠️ Ye dates already booked hain! ${overlap.guest_name} ki booking hai ${overlap.checkin} se ${overlap.checkout} tak (status: ${overlap.status}). Pehle wo cancel karo ya dates badlo.`,
      });
    }

    const advance = Number(advance_amount) || 0;
    const balance = Number(total_amount) - advance;
    const plat = platform || 'direct';

    // Direct/walk-in: koi platform commission nahi katta — Net Payout hamesha full Total hi hai
    const isDirectPlatform = plat === 'direct' || plat === 'walkin';
    const finalNetPayout = isDirectPlatform
      ? Number(total_amount)
      : (net_payout !== undefined && net_payout !== '' ? Number(net_payout) : Number(total_amount));

    const isPaid = !!balance_paid || balance <= 0;
    const bookingNo = (await Booking.countDocuments()) + 1;
    const booking = await Booking.create({
      property_id, guest_name, guest_phone: guest_phone || '',
      guest_email: '', checkin, checkout, nights,
      amount: advance, total_amount: Number(total_amount), balance_amount: balance,
      balance_paid: isPaid,
      balance_paid_at: isPaid ? new Date() : null,
      booking_no: bookingNo,
      payment_type: advance >= Number(total_amount) ? 'full' : 'partial',
      status: status || 'confirmed',
      platform: plat,
      net_payout: finalNetPayout,
      payout_received: !!payout_received,
      payout_received_at: payout_received ? new Date() : null,
      owner_paid: !!owner_paid,
      owner_paid_at: owner_paid ? new Date() : null,
      notes: notes || '',
    });

    // ── Automation chain: calendar auto-block + auto cleaning task + guest notify ──
    if ((status || 'confirmed') !== 'cancelled') {
      blockCalendarForBooking(property_id, checkin, checkout).catch(e => console.error('Calendar block error:', e.message));
      createCleaningTaskForCheckout(property_id, checkout).catch(e => console.error('Cleaning task error:', e.message));
      const prop = await Property.findById(property_id).lean().catch(() => null);
      if (guest_phone) {
        notifyGuestBookingCreated(booking.toObject(), prop?.name || '').catch(e => console.error('Notify error:', e.message));
      }
      // WhatsApp: owner + caretaker + admin ko turant update
      notifyTeamNewBooking(booking.toObject(), prop).catch(e => console.error('Team WhatsApp error:', e.message));
    }

    res.status(201).json({ booking: booking.toObject() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/bookings-log/:id', async (req, res) => {
  try {
    const existing = await Booking.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Booking nahi mili' });

    const body = { ...req.body };
    // Recalculate nights if dates changed
    if (body.checkin || body.checkout) {
      const cin  = new Date(((body.checkin  || existing.checkin)  + '').slice(0,10) + 'T12:00:00');
      const cout = new Date(((body.checkout || existing.checkout) + '').slice(0,10) + 'T12:00:00');
      body.nights = Math.max(1, Math.round((cout - cin) / (1000 * 60 * 60 * 24)));
    }
    // ── Double-booking check on edit (khud ko chhod ke) ──
    const effStatus = body.status || existing.status;
    if (effStatus !== 'cancelled') {
      const chkIn  = ((body.checkin  || existing.checkin)  + '').slice(0,10);
      const chkOut = ((body.checkout || existing.checkout) + '').slice(0,10);
      const propId = body.property_id || existing.property_id;
      const overlap = await Booking.findOne({
        _id:      { $ne: existing._id },
        property_id: propId,
        status:   { $nin: ['cancelled'] },
        checkin:  { $lt: chkOut },
        checkout: { $gt: chkIn },
      }).lean();
      if (overlap) {
        return res.status(409).json({
          error: `⚠️ Ye dates already booked hain! ${overlap.guest_name} ki booking hai ${overlap.checkin} se ${overlap.checkout} tak (status: ${overlap.status}).`,
        });
      }
    }
    // Recalculate balance whenever total or advance changes
    if (body.total_amount != null || body.advance_amount != null) {
      const newTotal   = body.total_amount   != null ? Number(body.total_amount)   : (existing.total_amount || existing.amount || 0);
      const newAdvance = body.advance_amount != null ? Number(body.advance_amount) : (existing.amount || 0);
      body.total_amount   = newTotal;
      body.amount         = newAdvance;
      body.balance_amount = Math.max(0, newTotal - newAdvance);
      body.payment_type   = newAdvance >= newTotal ? 'full' : 'partial';
      // Direct/walk-in: koi commission nahi katta — Net Payout hamesha Total ke barabar rakho
      const effPlatform = body.platform || existing.platform || 'direct';
      if (effPlatform === 'direct' || effPlatform === 'walkin') {
        body.net_payout = newTotal;
      }
    } else if (body.platform && (body.platform === 'direct' || body.platform === 'walkin')) {
      // Sirf platform badla Direct/Walk-in mein, amount touch nahi hui — phir bhi Net Payout ko Total ke barabar karo
      body.net_payout = existing.total_amount || existing.amount || 0;
    }
    // Stamp/clear full-payment date when balance_paid flips
    if (body.balance_paid === true && !existing.balance_paid) body.balance_paid_at = new Date();
    if (body.balance_paid === false) body.balance_paid_at = null;
    // Stamp/clear OTA payout date when payout_received flips
    if (body.payout_received === true && !existing.payout_received) body.payout_received_at = new Date();
    if (body.payout_received === false) body.payout_received_at = null;
    // Stamp/clear owner payment date when owner_paid flips
    if (body.owner_paid === true && !existing.owner_paid) body.owner_paid_at = new Date();
    if (body.owner_paid === false) body.owner_paid_at = null;
    const updated = await Booking.findByIdAndUpdate(req.params.id, body, { new: true }).lean();

    // ── Automation chain: dates changed → unblock old + block new; status → cancelled → unblock + notify ──
    const newCheckin  = body.checkin  || existing.checkin;
    const newCheckout = body.checkout || existing.checkout;
    const datesChanged = newCheckin !== existing.checkin || newCheckout !== existing.checkout;
    if (updated.status === 'cancelled') {
      unblockCalendarIfFree(existing.property_id, existing.checkin, existing.checkout, existing._id).catch(e => console.error(e.message));
      const prop = await Property.findById(existing.property_id).lean().catch(() => null);
      if (updated.guest_phone) {
        notifyGuestBookingCancelled(updated, prop?.name || '').catch(e => console.error(e.message));
      }
      // WhatsApp: cancel hone pe bhi team ko batao (sirf pehli baar)
      if (existing.status !== 'cancelled') {
        notifyTeamBookingCancelled(updated, prop).catch(e => console.error('Team WhatsApp error:', e.message));
      }
    } else {
      if (datesChanged) unblockCalendarIfFree(existing.property_id, existing.checkin, existing.checkout, existing._id).catch(e => console.error(e.message));
      blockCalendarForBooking(updated.property_id, newCheckin, newCheckout).catch(e => console.error(e.message));
      createCleaningTaskForCheckout(updated.property_id, newCheckout).catch(e => console.error(e.message));
    }

    res.json({ booking: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/bookings-log/:id', async (req, res) => {
  try {
    const existing = await Booking.findById(req.params.id).lean();
    if (existing) {
      unblockCalendarIfFree(existing.property_id, existing.checkin, existing.checkout, existing._id).catch(e => console.error(e.message));
    }
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ message: 'Booking deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cleaning Tracker ───────────────────────────────────
router.get('/cleaning', async (req, res) => {
  try {
    const { property_id } = req.query;
    const q = property_id ? { property_id } : {};
    const tasks = await CleaningTask.find(q).sort({ date: 1 }).lean();
    res.json({ tasks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cleaning', async (req, res) => {
  try {
    const { property_id, date, checkout_today, status, cleaned_by, notes } = req.body;
    if (!property_id || !date) return res.status(400).json({ error: 'Property aur date required hain' });
    const task = await CleaningTask.findOneAndUpdate(
      { property_id, date },
      { checkout_today: !!checkout_today, status: status || 'pending', cleaned_by: cleaned_by || '', notes: notes || '' },
      { new: true, upsert: true }
    ).lean();
    res.status(201).json({ task });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/cleaning/:id', async (req, res) => {
  try { await CleaningTask.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Expenses ───────────────────────────────────────────
router.get('/expenses', async (req, res) => {
  try {
    const { property_id } = req.query;
    const q = property_id ? { property_id } : {};
    const expenses = await Expense.find(q).sort({ date: -1 }).lean();
    res.json({ expenses });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/expenses', async (req, res) => {
  try {
    const { property_id, date, category, description, amount, paid_by, notes } = req.body;
    if (!date || !amount) return res.status(400).json({ error: 'Date aur amount required hain' });
    const expense = await Expense.create({ property_id: property_id || null, date, category, description, amount, paid_by, notes });
    res.status(201).json({ expense: expense.toObject() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/expenses/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    res.json({ expense });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/expenses/:id', async (req, res) => {
  try { await Expense.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Dashboard / Reports ────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const { from, to, property_id } = req.query;
    const q = { status: { $ne: 'cancelled' } };
    if (property_id) q.property_id = property_id;
    if (from || to) {
      q.checkin = {};
      if (from) q.checkin.$gte = from;
      if (to)   q.checkin.$lte = to;
    }
    const bookings = await Booking.find(q).lean();

    const totalBookings = bookings.length;
    const totalRevenue  = bookings.reduce((s, b) => s + (b.total_amount || b.amount || 0), 0);
    const totalNights   = bookings.reduce((s, b) => s + (b.nights || 0), 0);
    const pendingBalance= bookings.reduce((s, b) => s + (b.balance_paid ? 0 : (b.balance_amount || 0)), 0);
    const adr            = totalNights ? Math.round(totalRevenue / totalNights) : 0;

    const today = new Date(); today.setHours(0,0,0,0);
    const in7   = new Date(today); in7.setDate(in7.getDate() + 7);
    const fmt = (d) => d.toISOString().split('T')[0];
    const upcomingCheckins  = bookings.filter(b => b.checkin  >= fmt(today) && b.checkin  <= fmt(in7)).length;
    const upcomingCheckouts = bookings.filter(b => b.checkout >= fmt(today) && b.checkout <= fmt(in7)).length;

    const byPlatform = {};
    for (const b of bookings) {
      const p = b.platform || 'direct';
      if (!byPlatform[p]) byPlatform[p] = { bookings: 0, revenue: 0, net_payout: 0 };
      byPlatform[p].bookings += 1;
      byPlatform[p].revenue  += (b.total_amount || b.amount || 0);
      byPlatform[p].net_payout += (b.net_payout != null ? b.net_payout : (b.total_amount || b.amount || 0));
    }

    // occupancy: needs a date-range; default to 90 days if not given
    let rangeDays = 90;
    if (from && to) rangeDays = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / (1000*60*60*24)));
    const propCount = property_id ? 1 : await Property.countDocuments({ status: 'Active' });
    const occupancyPct = propCount ? Math.min(100, Math.round((totalNights / (propCount * rangeDays)) * 100)) : 0;

    res.json({
      total_bookings: totalBookings,
      total_revenue:  totalRevenue,
      total_nights:   totalNights,
      occupancy_pct:  occupancyPct,
      adr,
      upcoming_checkins:  upcomingCheckins,
      upcoming_checkouts: upcomingCheckouts,
      pending_balance: pendingBalance,
      by_platform: byPlatform,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Revenue Report ─────────────────────────────
router.get('/monthly-report', async (req, res) => {
  try {
    const { property_id } = req.query;
    const q = { status: { $ne: 'cancelled' } };
    if (property_id) q.property_id = property_id;
    const bookings = await Booking.find(q).lean();

    const months = {};
    for (const b of bookings) {
      const key = (b.checkin || '').slice(0, 7); // YYYY-MM
      if (!key) continue;
      if (!months[key]) months[key] = { month: key, total_bookings: 0, total_revenue: 0, total_nights: 0, by_platform: {} };
      months[key].total_bookings += 1;
      months[key].total_revenue  += (b.total_amount || b.amount || 0);
      months[key].total_nights   += (b.nights || 0);
      const p = b.platform || 'direct';
      months[key].by_platform[p] = (months[key].by_platform[p] || 0) + (b.total_amount || b.amount || 0);
    }
    const report = Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ report });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Owner Payout Summary (platform-wise) ───────────────
router.get('/payout-summary', async (req, res) => {
  try {
    const { property_id } = req.query;
    const q = { status: { $ne: 'cancelled' } };
    if (property_id) q.property_id = property_id;
    const bookings = await Booking.find(q).lean();

    const platforms = ['direct', 'airbnb', 'booking_com', 'agoda', 'mmt_goibibo', 'walkin'];
    const settingsDoc = await PlatformSetting.findOne({ property_id: null }).lean();

    const summary = platforms.map(p => {
      const rows = bookings.filter(b => (b.platform || 'direct') === p);
      const gross = rows.reduce((s, b) => s + (b.total_amount || b.amount || 0), 0);
      const net   = rows.reduce((s, b) => s + (b.net_payout != null ? b.net_payout : (b.total_amount || b.amount || 0)), 0);
      const cfg   = (settingsDoc?.platforms || {})[p] || {};
      return {
        platform: p,
        commission_pct: cfg.commission_pct || 0,
        bookings: rows.length,
        gross_revenue: gross,
        net_payout: net,
      };
    });
    res.json({ summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
