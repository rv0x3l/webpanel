import express from 'express';
import { authMiddleware, login } from './auth.js';
import { getDb } from './db.js';
import { getStatic, getLive, getServices, getDockerInfo } from './stats.js';
import { actions, runCommand } from './exec.js';
import { execOnServer } from './sshClient.js';
import * as sd from './systemd.js';
import * as dk from './docker.js';
import { RemoteStats } from './remoteStats.js';

// Cache RemoteStats per server id for /system/static (live stream uses its own per-WS instance)
const staticRemoteCache = new Map();
function getOrCreateRemote(srv) {
  let r = staticRemoteCache.get(srv.id);
  if (!r) { r = new RemoteStats(srv); staticRemoteCache.set(srv.id, r); }
  return r;
}

const router = express.Router();

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing creds' });
  const r = login(username, password);
  if (!r) return res.status(401).json({ error: 'invalid credentials' });
  res.cookie('token', r.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.json(r);
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

router.get('/system/static', authMiddleware, async (req, res) => {
  const serverId = parseInt(req.query.serverId || '0', 10);
  if (serverId) {
    const srv = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (srv && !srv.is_local) {
      try { return res.json(await getOrCreateRemote(srv).getStatic()); }
      catch (e) { return res.status(502).json({ error: 'SSH: ' + e.message }); }
    }
  }
  res.json(await getStatic());
});

router.get('/system/live', authMiddleware, async (req, res) => {
  const serverId = parseInt(req.query.serverId || '0', 10);
  if (serverId) {
    const srv = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (srv && !srv.is_local) {
      try { return res.json(await getOrCreateRemote(srv).getLive()); }
      catch (e) { return res.status(502).json({ error: 'SSH: ' + e.message }); }
    }
  }
  res.json(await getLive());
});

router.get('/system/services', authMiddleware, async (req, res) => {
  res.json(await getServices());
});

router.get('/system/docker', authMiddleware, async (req, res) => {
  res.json(await getDockerInfo());
});

router.post('/system/action', authMiddleware, async (req, res) => {
  const { action, args } = req.body || {};
  let result;
  switch (action) {
    case 'reboot':
      result = await actions.reboot();
      break;
    case 'poweroff':
      result = await actions.poweroff();
      break;
    case 'cancel-shutdown':
      result = await actions.cancelShutdown();
      break;
    case 'kill':
      result = await actions.killProcess(args?.pid, args?.signal);
      break;
    case 'service':
      result = await actions.serviceAction(args?.name, args?.op);
      break;
    case 'exec':
      result = await runCommand(args?.cmd || '');
      break;
    default:
      return res.status(400).json({ error: 'unknown action' });
  }
  res.json(result);
});

// === Systemd ===
router.get('/sd/units', authMiddleware, async (req, res) => {
  res.json(await sd.listUnits({ type: req.query.type, state: req.query.state }));
});
router.get('/sd/units/:name/status', authMiddleware, async (req, res) => {
  try { res.json(await sd.unitStatus(req.params.name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/sd/units/:name/show', authMiddleware, async (req, res) => {
  try { res.json(await sd.unitShow(req.params.name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/sd/units/:name/logs', authMiddleware, async (req, res) => {
  try { res.json(await sd.unitLogs(req.params.name, req.query.lines)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/sd/units/:name/action', authMiddleware, async (req, res) => {
  try { res.json(await sd.unitAction(req.params.name, req.body?.op)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/sd/daemon-reload', authMiddleware, async (req, res) => {
  res.json(await sd.daemonReload());
});

// === Docker ===
router.get('/dk/info', authMiddleware, async (req, res) => {
  const version = await dk.dockerAvailable();
  res.json({ available: !!version, version });
});
router.get('/dk/containers', authMiddleware, async (req, res) => {
  res.json(await dk.listContainers({ all: req.query.all !== '0' }));
});
router.get('/dk/images', authMiddleware, async (req, res) => {
  res.json(await dk.listImages());
});
router.post('/dk/containers/:id/action', authMiddleware, async (req, res) => {
  try { res.json(await dk.containerAction(req.params.id, req.body?.op)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/dk/containers/:id/logs', authMiddleware, async (req, res) => {
  try { res.json(await dk.containerLogs(req.params.id, req.query.lines)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/dk/containers/:id/inspect', authMiddleware, async (req, res) => {
  try { res.json(await dk.containerInspect(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/dk/containers/:id/stats', authMiddleware, async (req, res) => {
  try { res.json(await dk.containerStats(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/dk/images/:id', authMiddleware, async (req, res) => {
  try { res.json(await dk.imageRemove(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/dk/images/pull', authMiddleware, async (req, res) => {
  try { res.json(await dk.imagePull(req.body?.image || '')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/dk/prune', authMiddleware, async (req, res) => {
  try { res.json(await dk.prune(req.body?.target)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Server management (CRUD)
router.get('/servers', authMiddleware, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, host, port, username, auth_type, vnc_host, vnc_port,
           tags, is_local, created_at
    FROM servers ORDER BY is_local DESC, id ASC
  `).all();
  res.json(rows);
});

router.post('/servers', authMiddleware, (req, res) => {
  const db = getDb();
  const {
    name, host, port = 22, username, auth_type = 'password',
    password, private_key, vnc_host, vnc_port, vnc_password, tags,
  } = req.body || {};
  if (!name || !host || !username) {
    return res.status(400).json({ error: 'name, host, username required' });
  }
  const r = db.prepare(`
    INSERT INTO servers (name, host, port, username, auth_type, password, private_key,
                         vnc_host, vnc_port, vnc_password, tags, is_local, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(name, host, port, username, auth_type, password || null, private_key || null,
         vnc_host || null, vnc_port || null, vnc_password || null, tags || '', Date.now());
  res.json({ id: r.lastInsertRowid });
});

router.put('/servers/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const cur = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (cur.is_local) return res.status(400).json({ error: 'cannot edit local entry' });
  const fields = ['name','host','port','username','auth_type','password','private_key',
                  'vnc_host','vnc_port','vnc_password','tags'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.delete('/servers/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const cur = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (cur.is_local) return res.status(400).json({ error: 'cannot delete local entry' });
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/servers/:id/test', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!srv) return res.status(404).json({ error: 'not found' });
  if (srv.is_local) {
    const r = await runCommand('echo OK && uptime');
    return res.json(r);
  }
  try {
    const r = await execOnServer(srv, 'echo OK && uptime');
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Remote stats via SSH (basic snapshot)
router.get('/servers/:id/stats', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!srv) return res.status(404).json({ error: 'not found' });

  if (srv.is_local) {
    return res.json(await getLive());
  }

  const script = `
    echo "==UPTIME==" && uptime
    echo "==HOSTNAME==" && hostname
    echo "==LOADAVG==" && cat /proc/loadavg
    echo "==MEM==" && cat /proc/meminfo | head -10
    echo "==DISK==" && df -hP -x tmpfs -x devtmpfs
    echo "==CPU==" && grep -c ^processor /proc/cpuinfo
    echo "==OS==" && cat /etc/os-release 2>/dev/null | head -5
  `;
  try {
    const r = await execOnServer(srv, script);
    res.json({ raw: r.stdout, stderr: r.stderr, ok: r.ok });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
