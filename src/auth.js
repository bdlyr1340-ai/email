import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function validateAdmin(email, password) {
  return safeEqual(email, process.env.ADMIN_EMAIL || '') &&
    safeEqual(password, process.env.ADMIN_PASSWORD || '');
}

export function createAdminToken() {
  return jwt.sign(
    { role: 'admin', email: process.env.ADMIN_EMAIL },
    process.env.JWT_SECRET,
    { expiresIn: '12h', issuer: 'atlas-store' },
  );
}

export function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'atlas-store' });
    if (payload.role !== 'admin') throw new Error('Forbidden');
    req.admin = payload;
    next();
  } catch {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/admin/login');
  }
}
