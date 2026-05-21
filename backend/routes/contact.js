const router = require('express').Router();
const { Contact } = require('../db/models');
const { sendEmail } = require('../services/email');
const { protect, adminOnly } = require('../middleware/auth');

// POST /api/contact
router.post('/', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !subject || !message)
    return res.status(400).json({ error: 'Name, email, subject aur message required hain.' });

  // Escape HTML to prevent injection in admin email
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  try {
    await Contact.create({
      name:    name.trim(),
      email:   email.trim().toLowerCase(),
      phone:   phone || null,
      subject,
      message: message.trim(),
    });

    // Notify admin
    const adminEmail = process.env.EMAIL_USER || process.env.BUSINESS_EMAIL;
    if (adminEmail) {
      sendEmail(
        adminEmail,
        `New Contact Form: ${esc(subject)} — from ${esc(name)}`,
        `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;border:1px solid #eee;border-radius:10px;overflow:hidden">
          <div style="background:#8B1717;padding:20px 24px">
            <h2 style="color:#fff;margin:0;font-size:1.2rem">New Contact Form Submission</h2>
          </div>
          <div style="padding:24px">
            <table style="width:100%;border-collapse:collapse;font-size:.9rem">
              <tr><td style="color:#666;padding:6px 0;width:100px">Name</td><td style="font-weight:600">${esc(name)}</td></tr>
              <tr><td style="color:#666;padding:6px 0">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
              <tr><td style="color:#666;padding:6px 0">Phone</td><td>${phone ? esc(phone) : '—'}</td></tr>
              <tr><td style="color:#666;padding:6px 0">Subject</td><td style="font-weight:600">${esc(subject)}</td></tr>
            </table>
            <div style="background:#fafafa;border:1px solid #eee;border-radius:8px;padding:16px;margin-top:16px">
              <div style="font-size:.75rem;color:#999;font-weight:600;text-transform:uppercase;margin-bottom:8px">Message</div>
              <p style="margin:0;color:#333;white-space:pre-wrap">${esc(message)}</p>
            </div>
            <a href="mailto:${esc(email)}?subject=Re: ${esc(subject)}" style="display:inline-block;margin-top:16px;background:#8B1717;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:.9rem">Reply to ${esc(name)}</a>
          </div>
        </div>`
      ).catch(e => console.error('Contact email error:', e.message));
    }

    res.json({ message: 'Message received! We will get back to you within 24 hours.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contact  — admin only
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const submissions = await Contact.find().sort({ created_at: -1 }).lean();
    res.json({ submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
