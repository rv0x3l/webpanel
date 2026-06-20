// UFW (Uncomplicated Firewall) management plugin
const VALID_PROTO = ['tcp', 'udp', 'any'];
const VALID_ACTION = ['allow', 'deny', 'reject', 'limit'];

function sanePort(p) {
  const s = String(p || '');
  return /^\d{1,5}(:\d{1,5})?$/.test(s) ? s : null;
}
function saneFrom(s) {
  return /^[a-zA-Z0-9./:_-]{0,64}$/.test(String(s || '')) ? s : null;
}

async function checkInstalled(ctx) {
  const r = await ctx.runCommand('command -v ufw');
  return r.ok && r.stdout.trim().length > 0;
}

export default async function init(ctx) {
  ctx.router.get('/status', async (req, res) => {
    if (!(await checkInstalled(ctx))) {
      return res.json({
        ok: false,
        installed: false,
        output: 'UFW не установлен на сервере.\n\nУстановить:\n  apt install -y ufw\n\n  # или для других дистрибутивов:\n  dnf install ufw      # Fedora/RHEL\n  pacman -S ufw        # Arch',
      });
    }
    const r = await ctx.runCommand('ufw status numbered verbose 2>&1');
    res.json({ ok: r.ok, installed: true, output: r.stdout || r.stderr });
  });

  ctx.router.post('/enable', async (req, res) => {
    const r = await ctx.runCommand('ufw --force enable 2>&1');
    ctx.auditAs(req.user.id, 'enable', {});
    res.json(r);
  });
  ctx.router.post('/disable', async (req, res) => {
    const r = await ctx.runCommand('ufw disable 2>&1');
    ctx.auditAs(req.user.id, 'disable', {});
    res.json(r);
  });
  ctx.router.post('/reload', async (req, res) => {
    const r = await ctx.runCommand('ufw reload 2>&1');
    res.json(r);
  });

  ctx.router.post('/rule', async (req, res) => {
    const { action = 'allow', port, proto = 'tcp', from, comment } = req.body || {};
    if (!VALID_ACTION.includes(action)) return res.status(400).json({ error: 'invalid action' });
    const p = sanePort(port);
    const pr = VALID_PROTO.includes(proto) ? proto : 'tcp';
    const fr = saneFrom(from);
    if (!p) return res.status(400).json({ error: 'invalid port' });

    let cmd = `ufw ${action}`;
    if (fr) cmd += ` from ${fr}`;
    cmd += ` to any port ${p} proto ${pr === 'any' ? 'any' : pr}`;
    if (comment) {
      const safe = String(comment).replace(/['"`$;\\]/g, '').slice(0, 60);
      cmd += ` comment '${safe}'`;
    }
    const r = await ctx.runCommand(cmd + ' 2>&1');
    ctx.auditAs(req.user.id, 'rule.add', { cmd });
    res.json(r);
  });

  ctx.router.delete('/rule/:num', async (req, res) => {
    const num = parseInt(req.params.num, 10);
    if (!num || num <= 0) return res.status(400).json({ error: 'invalid number' });
    const r = await ctx.runCommand(`echo y | ufw delete ${num} 2>&1`);
    ctx.auditAs(req.user.id, 'rule.delete', { num });
    res.json(r);
  });
}
