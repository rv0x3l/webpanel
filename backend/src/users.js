import bcrypt from 'bcryptjs';
import { getDb } from './db.js';
import { generateSecret, otpauthUri, verifyTOTP } from './totp.js';
import { audit } from './audit.js';

const ROLES = ['viewer', 'operator', 'admin'];

export function listUsers() {
  return getDb().prepare(
    'SELECT id, username, role, totp_enabled, created_at FROM users ORDER BY id'
  ).all();
}

export function createUser({ username, password, role = 'operator' }) {
  if (!username || !password) throw new Error('username and password required');
  if (!ROLES.includes(role)) throw new Error('invalid role');
  const hash = bcrypt.hashSync(password, 10);
  try {
    const r = getDb().prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, hash, role, Date.now());
    return r.lastInsertRowid;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new Error('username taken');
    throw e;
  }
}

export function updateUser(id, { password, role }) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new Error('not found');
  const updates = [];
  const values = [];
  if (password) { updates.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }
  if (role) {
    if (!ROLES.includes(role)) throw new Error('invalid role');
    updates.push('role = ?'); values.push(role);
  }
  if (!updates.length) return;
  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteUser(id) {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new Error('not found');
  if (cur.role === 'admin' && count <= 1) throw new Error('cannot delete last admin');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(id);
}

// === 2FA ===
export function enrollTotp(userId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('not found');
  const secret = generateSecret();
  // store pending secret in totp_secret but keep enabled=0
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, userId);
  return { secret, uri: otpauthUri(user.username, secret) };
}

export function confirmTotp(userId, code) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.totp_secret) throw new Error('no enrollment pending');
  if (!verifyTOTP(user.totp_secret, code)) throw new Error('invalid code');
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  audit(userId, 'totp.enabled', {});
  return true;
}

export function disableTotp(userId, code) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('not found');
  if (!user.totp_enabled) return true;
  if (!verifyTOTP(user.totp_secret, code)) throw new Error('invalid code');
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(userId);
  audit(userId, 'totp.disabled', {});
  return true;
}
