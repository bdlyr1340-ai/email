import crypto from 'node:crypto';

function keyBuffer() {
  const raw = process.env.INVENTORY_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error('INVENTORY_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
  }
  return Buffer.from(raw, 'hex');
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptJson(value) {
  if (!value) return null;
  const [ivB64, tagB64, encryptedB64] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64url')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function stableHash(value, secret = process.env.ABUSE_HASH_SECRET || process.env.JWT_SECRET || 'local') {
  return crypto.createHmac('sha256', secret).update(String(value || '')).digest('hex');
}
