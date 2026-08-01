const router = require('express').Router();
const { CheckinToken, PropertySOP } = require('../db/models');
const { notifyAdminGuestSigned }    = require('../services/notify');

const ADMIN_PHONE = process.env.ADMIN_PHONE || '';

// GET /api/checkin/:token  — guest opens link
router.get('/:token', async (req, res) => {
  try {
    const row = await CheckinToken.findOne({ token: req.params.token })
      .populate('booking_id',  'guest_name checkin checkout guests')
      .populate('property_id', 'name location')
      .lean();

    if (!row) return res.status(404).json({ error: 'Link not found or expired' });

    const sop = await PropertySOP.findOne({ property_id: row.property_id._id }).lean();

    res.json({
      guest_name:        row.booking_id?.guest_name,
      checkin:           row.booking_id?.checkin,
      checkout:          row.booking_id?.checkout,
      num_guests:        row.booking_id?.guests,
      property_name:     row.property_id?.name,
      property_location: row.property_id?.location,
      room_photos:       JSON.parse(row.room_photos || '[]'),
      sop_photo:         sop?.sop_photo || null,
      already_signed:    !!row.signed_at,
      signed_at:         row.signed_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checkin/:token/sign  — guest signs house rules
router.post('/:token/sign', async (req, res) => {
  try {
    const { guest_signed_name } = req.body;
    if (!guest_signed_name?.trim()) return res.status(400).json({ error: 'Please enter your name to sign' });

    const row = await CheckinToken.findOne({ token: req.params.token })
      .populate('booking_id',  'guest_name')
      .populate('property_id', 'name')
      .lean();

    if (!row) return res.status(404).json({ error: 'Link not found' });
    if (row.signed_at) return res.json({ success: true, already_signed: true });

    await CheckinToken.findOneAndUpdate(
      { token: req.params.token },
      { guest_signed_name: guest_signed_name.trim(), signed_at: new Date() }
    );

    notifyAdminGuestSigned(ADMIN_PHONE, guest_signed_name.trim(), row.property_id?.name);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
