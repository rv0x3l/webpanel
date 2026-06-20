import { getDb } from './db.js';
import { EventEmitter } from 'node:events';

export const events = new EventEmitter();
events.setMaxListeners(50);

export function audit(userId, action, details) {
  try {
    getDb().prepare(
      'INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, ?)'
    ).run(userId || null, action, typeof details === 'string' ? details : JSON.stringify(details || {}), Date.now());
    events.emit('audit', { userId, action, details, ts: Date.now() });
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

export function recentAudit(limit = 200) {
  return getDb().prepare(
    'SELECT al.*, u.username FROM audit_log al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.id DESC LIMIT ?'
  ).all(Math.min(limit, 1000));
}
