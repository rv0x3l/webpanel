import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { verifyTOTP } from './totp.js';

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

export function passwordCheck(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

export function issueToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function issueTmpToken(user) {
  // short-lived token marking that password was OK, used for 2FA second step
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, step: 'totp' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

export function verifyTotpStep(tmpToken, code) {
  let payload;
  try { payload = jwt.verify(tmpToken, process.env.JWT_SECRET); }
  catch { return null; }
  if (payload.step !== 'totp') return null;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.totp_enabled || !user.totp_secret) return null;
  if (!verifyTOTP(user.totp_secret, code)) return null;
  return user;
}

export function login(username, password) {
  const user = passwordCheck(username, password);
  if (!user) return null;
  if (user.totp_enabled) {
    return { step: 'totp', tmpToken: issueTmpToken(user) };
  }
  return {
    token: issueToken(user),
    user: { id: user.id, username: user.username, role: user.role, totp_enabled: !!user.totp_enabled },
  };
}

export function hashApiToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateApiToken() {
  // Format: wp_<32 hex chars> (40 chars total)
  return 'wp_' + crypto.randomBytes(16).toString('hex');
}

function userFromApiToken(token) {
  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, t.id as token_id, t.scopes
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
  `).get(hashApiToken(token));
  if (!row) return null;
  try {
    getDb().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.token_id);
  } catch {}
  return row;
}

export function authMiddleware(req, res, next) {
  // 1. X-API-Token header (highest priority)
  const apiHeader = req.headers['x-api-token'];
  if (apiHeader) {
    const u = userFromApiToken(apiHeader);
    if (u) {
      req.user = { id: u.id, username: u.username, role: u.role, viaToken: true, scopes: u.scopes };
      // Enforce write scope for non-GET when scopes != write
      if (u.scopes !== 'write' && req.method !== 'GET') {
        return res.status(403).json({ error: 'token is read-only' });
      }
      return next();
    }
    return res.status(401).json({ error: 'invalid api token' });
  }
  // 2. JWT cookie / Bearer
  const a = req.headers.authorization || '';
  const token = a.startsWith('Bearer ') ? a.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.step) return res.status(401).json({ error: 'incomplete auth' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

export function requireRole(minRole) {
  const min = ROLE_RANK[minRole] || ROLE_RANK.admin;
  return (req, res, next) => {
    const rank = ROLE_RANK[req.user?.role] || 0;
    if (rank < min) return res.status(403).json({ error: 'role required: ' + minRole });
    next();
  };
}

export function verifyToken(token) {
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
}
