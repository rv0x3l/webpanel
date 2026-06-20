import { generateApiToken, hashApiToken } from '../../src/auth.js';

export default async function init(ctx) {
  ctx.router.get('/', (req, res) => {
    const rows = ctx.db.prepare(`
      SELECT t.id, t.name, t.scopes, t.created_at, t.last_used_at, u.username
      FROM api_tokens t JOIN users u ON u.id = t.user_id
      ORDER BY t.id DESC
    `).all();
    res.json(rows);
  });

  ctx.router.post('/', (req, res) => {
    const { name, scopes = 'read', userId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!['read', 'write'].includes(scopes)) return res.status(400).json({ error: 'invalid scopes' });
    const uid = userId ? parseInt(userId, 10) : req.user.id;
    const token = generateApiToken();
    const r = ctx.db.prepare(`
      INSERT INTO api_tokens (user_id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(uid, name, hashApiToken(token), scopes, Date.now());
    ctx.auditAs(req.user.id, 'create', { id: r.lastInsertRowid, name, scopes, userId: uid });
    // Token is returned exactly once.
    res.json({ id: r.lastInsertRowid, token, note: 'Сохрани токен — он показывается только один раз' });
  });

  ctx.router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const r = ctx.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
    if (r.changes) ctx.auditAs(req.user.id, 'revoke', { id });
    res.json({ ok: r.changes > 0 });
  });
}
