// Telegram alerts plugin
// Sends messages to a TG chat on:
//   - high cpu / mem / disk (thresholds configurable)
//   - failed login attempts
//   - audit events (optional filter)
// Polls /system/live every 30s for threshold checks.

const DEFAULTS = {
  enabled: false,
  bot_token: '',
  chat_id: '',
  thresholds: { cpu: 90, mem: 90, disk: 90 },
  alerts: {
    high_cpu: true,
    high_mem: true,
    high_disk: true,
    auth_fail: true,
    service_failed: true,
  },
};

async function tgSend(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`TG API ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

function fmtPct(x) { return (x ?? 0).toFixed(1) + '%'; }
function escTg(s) { return String(s ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }

export default async function init(ctx) {
  // Ensure defaults
  const cfg = { ...DEFAULTS, ...ctx.settings.all() };
  for (const k of Object.keys(DEFAULTS)) {
    if (ctx.settings.get(k) === null) ctx.settings.set(k, DEFAULTS[k]);
  }

  // --- ROUTES ---
  ctx.router.get('/config', (req, res) => {
    const c = ctx.settings.all();
    // Don't expose bot_token in clear; mask
    res.json({ ...DEFAULTS, ...c, bot_token_set: !!c.bot_token, bot_token: undefined });
  });

  ctx.router.post('/config', (req, res) => {
    const fields = ['enabled', 'chat_id', 'thresholds', 'alerts'];
    for (const f of fields) if (req.body[f] !== undefined) ctx.settings.set(f, req.body[f]);
    if (req.body.bot_token) ctx.settings.set('bot_token', req.body.bot_token);
    ctx.auditAs(req.user.id, 'config.update', { fields: Object.keys(req.body || {}) });
    res.json({ ok: true });
  });

  ctx.router.post('/test', async (req, res) => {
    const c = ctx.settings.all();
    if (!c.bot_token || !c.chat_id) return res.status(400).json({ error: 'bot_token & chat_id required' });
    try {
      await tgSend(c.bot_token, c.chat_id, '✅ <b>WebPanel</b> — тестовое сообщение');
      ctx.auditAs(req.user.id, 'test.sent', {});
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  ctx.router.post('/send', async (req, res) => {
    const c = ctx.settings.all();
    if (!c.enabled || !c.bot_token || !c.chat_id) return res.status(400).json({ error: 'not configured' });
    const text = String(req.body?.text || '').slice(0, 4000);
    try { await tgSend(c.bot_token, c.chat_id, text); res.json({ ok: true }); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });

  // --- Notifier helper ---
  async function notify(text) {
    const c = ctx.settings.all();
    if (!c.enabled || !c.bot_token || !c.chat_id) return;
    try { await tgSend(c.bot_token, c.chat_id, text); }
    catch (e) { console.error('[webhook-tg]', e.message); }
  }

  // --- Threshold checks (every 30s) ---
  const flapState = {}; // key -> {firing:bool, since:ts}
  function shouldFire(key, condition) {
    const s = flapState[key] = flapState[key] || { firing: false };
    if (condition && !s.firing) { s.firing = true; s.since = Date.now(); return 'fire'; }
    if (!condition && s.firing)  { s.firing = false;                    return 'clear'; }
    return null;
  }

  async function checkSystem() {
    const c = ctx.settings.all();
    if (!c.enabled) return;
    try {
      const live = await ctx.getLive();
      const cpu = live.cpu.load;
      const memUse = (live.mem.used / live.mem.total) * 100;
      const rootDisk = live.disks.find(d => d.mount === '/') || live.disks[0];
      const diskUse = rootDisk?.use || 0;

      if (c.alerts?.high_cpu) {
        const evt = shouldFire('cpu', cpu >= (c.thresholds?.cpu ?? 90));
        if (evt === 'fire')  await notify(`🔥 <b>CPU high</b>: ${fmtPct(cpu)} (≥${c.thresholds.cpu}%)`);
        if (evt === 'clear') await notify(`✅ <b>CPU OK</b>: ${fmtPct(cpu)}`);
      }
      if (c.alerts?.high_mem) {
        const evt = shouldFire('mem', memUse >= (c.thresholds?.mem ?? 90));
        if (evt === 'fire')  await notify(`💾 <b>RAM high</b>: ${fmtPct(memUse)} (≥${c.thresholds.mem}%)`);
        if (evt === 'clear') await notify(`✅ <b>RAM OK</b>: ${fmtPct(memUse)}`);
      }
      if (c.alerts?.high_disk && rootDisk) {
        const evt = shouldFire('disk', diskUse >= (c.thresholds?.disk ?? 90));
        if (evt === 'fire')  await notify(`🗄 <b>Disk high</b>: ${fmtPct(diskUse)} (${escTg(rootDisk.mount)}, ≥${c.thresholds.disk}%)`);
        if (evt === 'clear') await notify(`✅ <b>Disk OK</b>: ${fmtPct(diskUse)}`);
      }
    } catch {}
  }
  const iv = setInterval(checkSystem, 30_000);
  setTimeout(checkSystem, 5_000); // initial

  // --- Audit event hook ---
  ctx.events.on('audit', ev => {
    const c = ctx.settings.all();
    if (!c.enabled) return;
    if (ev.action === 'auth.fail' && c.alerts?.auth_fail) {
      notify(`⚠️ <b>Failed login</b> for <code>${escTg(ev.details?.username || '?')}</code> from <code>${escTg(ev.details?.ip || '?')}</code>`);
    }
  });

  // cleanup hook
  process.on('SIGINT',  () => clearInterval(iv));
  process.on('SIGTERM', () => clearInterval(iv));
}
