import fs from 'node:fs/promises';
import path from 'node:path';

const CRON_DIR = '/etc/cron.d';
const PREFIX = 'webpanel-';
const NAME_RE = /^[a-zA-Z0-9_.-]{1,40}$/;
const SCHEDULE_RE = /^[\d*,/\s-]{1,80}$/;
// Allow @reboot/@hourly/@daily/@weekly/@monthly shortcuts too
const SHORTCUTS = ['@reboot', '@hourly', '@daily', '@weekly', '@monthly', '@yearly'];

function validSchedule(s) {
  const t = String(s || '').trim();
  if (SHORTCUTS.includes(t)) return t;
  // Cron with 5 fields
  if (/^(\S+\s+){4}\S+$/.test(t) && SCHEDULE_RE.test(t)) return t;
  return null;
}

export default async function init(ctx) {
  ctx.router.get('/', async (req, res) => {
    try {
      const files = (await fs.readdir(CRON_DIR)).filter(f => f.startsWith(PREFIX));
      const tasks = await Promise.all(files.map(async f => {
        const content = await fs.readFile(path.join(CRON_DIR, f), 'utf-8');
        const lines = content.split('\n').filter(Boolean).filter(l => !l.startsWith('#'));
        const main = lines.find(l => !/^[A-Z_]+=/.test(l)) || '';
        // schedule  user  command
        const m = main.match(/^(\S+(?:\s+\S+){0,4})\s+(\S+)\s+(.+)$/);
        const isShort = SHORTCUTS.some(sc => main.startsWith(sc));
        const m2 = isShort ? main.match(/^(\S+)\s+(\S+)\s+(.+)$/) : null;
        return {
          name: f.slice(PREFIX.length),
          schedule: (m2 ? m2[1] : (m ? m[1] : '')) || '',
          user: (m2 ? m2[2] : (m ? m[2] : '')) || '',
          command: (m2 ? m2[3] : (m ? m[3] : '')) || '',
        };
      }));
      res.json(tasks);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  ctx.router.post('/', async (req, res) => {
    try {
      const name = String(req.body?.name || '');
      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'invalid name (a-z0-9_-)' });
      const schedule = validSchedule(req.body?.schedule);
      if (!schedule) return res.status(400).json({ error: 'invalid schedule' });
      const user = String(req.body?.user || 'root').replace(/[^a-z0-9_-]/gi, '');
      const command = String(req.body?.command || '').replace(/[\r\n]/g, ' ');
      if (!command) return res.status(400).json({ error: 'command required' });

      const filename = path.join(CRON_DIR, PREFIX + name);
      const content = `# Managed by WebPanel\nSHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n${schedule} ${user} ${command}\n`;
      await fs.writeFile(filename, content, { mode: 0o644 });
      ctx.auditAs(req.user.id, 'save', { name, schedule, user });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.delete('/:name', async (req, res) => {
    try {
      const name = req.params.name;
      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
      await fs.unlink(path.join(CRON_DIR, PREFIX + name));
      ctx.auditAs(req.user.id, 'delete', { name });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
