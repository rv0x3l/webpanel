import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32decode(b32) {
  const map = {};
  for (let i = 0; i < 32; i++) map[B32[i]] = i;
  const clean = b32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    const v = map[c];
    if (v === undefined) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTOTP(secret, time = Math.floor(Date.now() / 1000), step = 30, digits = 6) {
  const counter = Math.floor(time / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const key = base32decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24)
             | ((hmac[off + 1] & 0xff) << 16)
             | ((hmac[off + 2] & 0xff) << 8)
             |  (hmac[off + 3] & 0xff);
  return String(code % (10 ** digits)).padStart(digits, '0');
}

export function verifyTOTP(secret, code, window = 1) {
  if (!secret || !code) return false;
  const c = String(code).replace(/\s+/g, '');
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    if (generateTOTP(secret, now + i * 30) === c) return true;
  }
  return false;
}

export function otpauthUri(label, secret, issuer = 'WebPanel') {
  const l = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${l}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
