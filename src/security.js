import jwt from 'jsonwebtoken';
import { query } from './db.js';
import { stableHash } from './crypto.js';
import { config } from './config.js';

const COLORS = [
  { key: 'red', ar: 'الأحمر', en: 'red', hex: '#ef4444' },
  { key: 'blue', ar: 'الأزرق', en: 'blue', hex: '#3b82f6' },
  { key: 'green', ar: 'الأخضر', en: 'green', hex: '#22c55e' },
  { key: 'yellow', ar: 'الأصفر', en: 'yellow', hex: '#eab308' },
];

export function createChallenge(locale = 'ar') {
  const secret = process.env.CAPTCHA_SECRET || process.env.JWT_SECRET;
  if (Math.random() < 0.5) {
    const a = 2 + Math.floor(Math.random() * 8);
    const b = 1 + Math.floor(Math.random() * 8);
    const token = jwt.sign({ kind: 'math', answer: String(a + b) }, secret, { expiresIn: '5m', issuer: 'atlas-captcha' });
    return { kind: 'math', prompt: `${a} + ${b} = ؟`, token };
  }

  const target = COLORS[Math.floor(Math.random() * COLORS.length)];
  const shuffled = [...COLORS].sort(() => Math.random() - 0.5);
  const token = jwt.sign({ kind: 'color', answer: target.key }, secret, { expiresIn: '5m', issuer: 'atlas-captcha' });
  return {
    kind: 'color',
    prompt: locale === 'ar' ? `اختَر اللون ${target.ar}` : `Choose the ${target.en} color`,
    options: shuffled,
    token,
  };
}

export function verifyChallenge(token, answer) {
  try {
    const secret = process.env.CAPTCHA_SECRET || process.env.JWT_SECRET;
    const payload = jwt.verify(token, secret, { issuer: 'atlas-captcha' });
    return String(payload.answer).toLowerCase() === String(answer || '').trim().toLowerCase();
  } catch {
    return false;
  }
}

export async function verifyTurnstile(token, remoteip) {
  if (!process.env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteip) body.set('remoteip', remoteip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json();
  return Boolean(result.success);
}

export function requestIdentity(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const fingerprint = [req.get('user-agent'), req.get('accept-language'), req.body?.browser_tz].filter(Boolean).join('|');
  return { ipHash: stableHash(ip), fingerprintHash: stableHash(fingerprint) };
}

export async function enforceCheckoutAbuseLimits({ ipHash, contact }) {
  const contactHash = stableHash(String(contact).trim().toLowerCase());
  const [ipCount, pendingCount] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM abuse_events WHERE ip_hash=$1 AND event_type='CHECKOUT' AND created_at > NOW() - INTERVAL '15 minutes'`, [ipHash]),
    query(`SELECT COUNT(*)::int AS count FROM orders WHERE LOWER(customer_contact)=LOWER($1) AND status='PENDING' AND created_at > NOW() - INTERVAL '2 hours'`, [contact]),
  ]);
  if (ipCount.rows[0].count >= config.maxCheckoutsPerIp15m) {
    throw new Error('TOO_MANY_CHECKOUTS');
  }
  if (pendingCount.rows[0].count >= config.maxPendingPerContact) {
    throw new Error('TOO_MANY_PENDING');
  }
  await query(`INSERT INTO abuse_events(ip_hash, contact_hash, event_type) VALUES($1,$2,'CHECKOUT')`, [ipHash, contactHash]);
}
