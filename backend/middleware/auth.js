// ── Auth Middleware (MongoDB version) ─────────────────
const jwt  = require('jsonwebtoken');
const { User } = require('../db/models');

async function protect(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Not authenticated' });
  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select('-password -__v').lean();
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = { ...user, id: user._id.toString() };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select('-password -__v').lean();
    if (user) req.user = { ...user, id: user._id.toString() };
  } catch { /* ignore */ }
  next();
}

async function staffProtect(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Not authenticated' });
  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'staff')
      return res.status(401).json({ error: 'Invalid staff token' });
    const { Staff } = require('../db/models');
    const staff = await Staff.findById(decoded.id).lean();
    if (!staff) return res.status(401).json({ error: 'Staff not found' });
    if (staff.status !== 'active') return res.status(403).json({ error: 'Account deactivated. Contact admin.' });
    req.staff = { ...staff, id: staff._id.toString(), property_id: staff.property_id?.toString() || null };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { protect, adminOnly, optionalAuth, staffProtect };
