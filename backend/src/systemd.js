import { runCommand } from './exec.js';

// Sanitize unit name: letters, digits, dots, dashes, underscores, @, :
const UNIT_RE = /^[a-zA-Z0-9._@:-]+$/;

function safeUnit(name) {
  if (!name || !UNIT_RE.test(name)) throw new Error('invalid unit name');
  return name;
}

const ALLOWED_OPS = new Set([
  'start', 'stop', 'restart', 'reload', 'enable', 'disable',
  'mask', 'unmask', 'reload-or-restart',
]);

export async function listUnits({ type = 'service', state = 'all' } = {}) {
  const t = ['service', 'socket', 'timer', 'mount', 'target', 'path'].includes(type) ? type : 'service';
  const s = ['all', 'running', 'failed', 'loaded', 'active', 'inactive'].includes(state) ? state : 'all';
  // When 'all' is selected, drop the --state filter (systemctl treats --state=all as a literal state, returning nothing)
  const stateFlag = s === 'all' ? '--all' : `--state=${s} --all`;
  const r = await runCommand(`systemctl list-units --type=${t} ${stateFlag} --no-legend --no-pager --plain`);
  if (!r.ok) return [];
  const lines = r.stdout.split('\n').filter(l => l.trim());
  return lines.map(line => {
    // UNIT LOAD ACTIVE SUB DESCRIPTION
    const parts = line.trim().split(/\s+/);
    const name = parts[0];
    const load = parts[1];
    const active = parts[2];
    const sub = parts[3];
    const description = parts.slice(4).join(' ');
    return { name, load, active, sub, description, running: active === 'active' };
  });
}

export async function unitStatus(name) {
  const n = safeUnit(name);
  const r = await runCommand(`systemctl status ${n} --no-pager -n 0 -l`);
  return { ok: r.ok, output: r.stdout || r.stderr };
}

export async function unitShow(name) {
  const n = safeUnit(name);
  const r = await runCommand(`systemctl show ${n} --no-pager`);
  if (!r.ok) return null;
  const out = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export async function unitAction(name, op) {
  const n = safeUnit(name);
  if (!ALLOWED_OPS.has(op)) throw new Error('invalid op');
  return runCommand(`systemctl ${op} ${n}`);
}

export async function unitLogs(name, lines = 100) {
  const n = safeUnit(name);
  const ln = Math.max(10, Math.min(2000, parseInt(lines, 10) || 100));
  const r = await runCommand(`journalctl -u ${n} -n ${ln} --no-pager --output=short-iso`);
  return { ok: r.ok, output: r.stdout || r.stderr };
}

export async function daemonReload() {
  return runCommand('systemctl daemon-reload');
}
