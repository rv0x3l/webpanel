// Frontend SPA — Vercel/Cloudflare-style server panel
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  user: null,
  servers: [],
  activeServerId: null,
  ws: null,
  history: { cpu: [], mem: [], disk: [], net: [] },
  lastNet: null,
};

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ---------- Auth ----------
async function checkAuth() {
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    return true;
  } catch {
    return false;
  }
}
function showLogin() {
  $('#login').hidden = false;
  $('#app').hidden = true;
}
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#me-username').textContent = state.user?.username || '';
}

let loginTmpToken = null;
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = $('#login-error');
  err.hidden = true;
  try {
    if ($('#login-step2').hidden) {
      // Step 1: username + password
      const r = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
      });
      if (!r.ok) throw new Error('invalid');
      const d = await r.json();
      if (d.step === 'totp') {
        loginTmpToken = d.tmpToken;
        $('#login-step1').hidden = true;
        $('#login-step2').hidden = false;
        $('#login-subtitle').textContent = 'Введи код из приложения 2FA';
        $('#login-form').elements.totp.focus();
        return;
      }
      state.user = d.user;
      showApp();
      await boot();
    } else {
      // Step 2: TOTP
      const r = await fetch('/api/auth/totp', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmpToken: loginTmpToken, code: fd.get('totp') }),
      });
      if (!r.ok) throw new Error('invalid');
      const d = await r.json();
      state.user = d.user;
      showApp();
      await boot();
    }
  } catch {
    err.textContent = $('#login-step2').hidden ? 'Неверный логин или пароль' : 'Неверный код 2FA';
    err.hidden = false;
  }
});
$('#logout-btn')?.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

// ---------- Boot ----------
async function boot() {
  await loadServers();
  await loadPlugins();
  buildAdminNav();
  applyRoleUi();
  connectStatsWs();
  navigate(location.hash || '#/dashboard');
}

// Hide nav items the user has no rights to use
function applyRoleUi() {
  const role = state.user?.role;
  const rank = { viewer: 1, operator: 2, admin: 3 }[role] || 0;
  // Terminal and VNC require operator
  $$('.sidebar nav a[data-route="terminal"], .sidebar nav a[data-route="vnc"]').forEach(a => {
    a.hidden = rank < 2;
  });
  document.body.dataset.role = role || '';
}

// ---------- Plugins ----------
async function loadPlugins() {
  try {
    state.plugins = await api('/plugins');
  } catch { state.plugins = []; }
  const nav = $('#plugins-nav');
  if (!state.plugins.length) { nav.hidden = true; nav.innerHTML = ''; return; }
  nav.hidden = false;
  nav.innerHTML =
    '<div class="nav-section-label">Плагины</div>' +
    '<div class="nav-list">' +
      state.plugins.map(p =>
        `<a href="#/p/${escapeHtml(p.name)}" data-route="p:${escapeHtml(p.name)}">
           <span class="icon">${escapeHtml(p.icon)}</span>${escapeHtml(p.label)}
         </a>`
      ).join('') +
    '</div>';
}

function buildAdminNav() {
  const nav = $('#admin-nav');
  const isAdmin = state.user?.role === 'admin';
  if (!isAdmin) { nav.hidden = true; nav.innerHTML = ''; return; }
  nav.hidden = false;
  nav.innerHTML =
    '<div class="nav-section-label">Админ</div>' +
    '<div class="nav-list">' +
      '<a href="#/users"   data-route="users"><span class="icon">👥</span>Пользователи</a>' +
      '<a href="#/plugins" data-route="plugins"><span class="icon">🔌</span>Плагины</a>' +
      '<a href="#/audit"   data-route="audit"><span class="icon">📜</span>Журнал</a>' +
    '</div>';
}

window.addEventListener('hashchange', () => navigate(location.hash));

async function loadServers() {
  state.servers = await api('/servers');
  if (!state.activeServerId && state.servers.length) {
    state.activeServerId = state.servers[0].id;
  }
  const sel = $('#active-server');
  sel.innerHTML = state.servers
    .map(s => `<option value="${s.id}" ${s.id === state.activeServerId ? 'selected' : ''}>${s.is_local ? '★ ' : ''}${escapeHtml(s.name)}</option>`)
    .join('');
  sel.onchange = () => {
    state.activeServerId = parseInt(sel.value, 10);
    // reset history so sparklines don't mix data from different servers
    state.history = { cpu: [], mem: [], disk: [], net: [] };
    state.lastNet = null;
    // reconnect stats stream to new server
    connectStatsWs();
    // re-render current view
    navigate(location.hash);
  };
}

// ---------- Router ----------
function navigate(hash) {
  const route = (hash || '#/dashboard').replace('#/', '');
  // mark active in core + plugins + admin nav
  $$('.sidebar a[data-route]').forEach(a => {
    const isPlugin = route.startsWith('p/');
    a.classList.toggle('active',
      a.dataset.route === route ||
      (isPlugin && a.dataset.route === 'p:' + route.slice(2)));
  });
  const view = $('#view');
  view.innerHTML = '';

  // Plugin route
  if (route.startsWith('p/')) {
    const pluginName = route.slice(2);
    initPluginView(pluginName);
    return;
  }

  const tpl = $(`#tpl-${route}`);
  if (!tpl) { view.innerHTML = '<div class="card">Раздел не найден.</div>'; return; }
  view.appendChild(tpl.content.cloneNode(true));
  $('#crumb').textContent = {
    dashboard: 'Дашборд',
    servers: 'Серверы',
    terminal: 'Терминал',
    vnc: 'VNC',
    services: 'Сервисы',
    processes: 'Процессы',
    docker: 'Docker',
    profile: 'Профиль',
    users: 'Пользователи',
    audit: 'Журнал действий',
    plugins: 'Плагины',
  }[route] || route;

  ({
    dashboard: initDashboard,
    servers: initServers,
    terminal: initTerminal,
    vnc: initVnc,
    services: initServices,
    processes: initProcesses,
    docker: initDocker,
    profile: initProfile,
    users: initUsers,
    audit: initAudit,
    plugins: initPluginsAdmin,
  })[route]?.();
}

async function initPluginsAdmin() {
  const grid = $('#plugins-grid');
  grid.innerHTML = '<div class="muted">Загрузка…</div>';
  const all = await api('/plugins/admin');
  grid.innerHTML = all.map(p => `
    <div class="plugin-card ${p.enabled ? '' : 'off'}" data-name="${escapeHtml(p.name)}">
      <div class="plugin-card-head">
        <div>
          <div class="plugin-card-title"><span class="icon">${escapeHtml(p.icon)}</span>${escapeHtml(p.label)}</div>
          <div class="plugin-card-meta">
            <span class="badge tag">v${escapeHtml(p.version)}</span>
            <span class="badge tag">role: ${escapeHtml(p.minRole)}</span>
            <span class="badge ${p.enabled ? 'on' : 'off'}">${p.enabled ? 'enabled' : 'disabled'}</span>
          </div>
        </div>
        <label class="switch" title="Включить/выключить">
          <input type="checkbox" data-toggle="${escapeHtml(p.name)}" ${p.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="plugin-card-desc">${escapeHtml(p.description || '')}</div>
    </div>`).join('') || '<div class="muted">Плагинов нет</div>';

  grid.onclick = () => {}; // ignore
  $$('#plugins-grid [data-toggle]').forEach(input => {
    input.onchange = async (e) => {
      const name = input.dataset.toggle;
      const enabled = e.target.checked;
      try {
        await api(`/plugins/${encodeURIComponent(name)}/toggle`, {
          method: 'POST', body: JSON.stringify({ enabled }),
        });
        toast(enabled ? `✅ ${name} включён` : `⏸ ${name} выключен`);
        // Update sidebar nav
        await loadPlugins();
        // Update card visual state
        const card = grid.querySelector(`[data-name="${name}"]`);
        card?.classList.toggle('off', !enabled);
        card?.querySelector('.badge.on, .badge.off')?.replaceWith(
          Object.assign(document.createElement('span'), {
            className: 'badge ' + (enabled ? 'on' : 'off'),
            textContent: enabled ? 'enabled' : 'disabled',
          })
        );
      } catch (err) {
        toast('Ошибка: ' + err.message);
        e.target.checked = !enabled; // revert
      }
    };
  });
}

// ---------- Plugin view loader ----------
async function initPluginView(name) {
  const view = $('#view');
  const plugin = state.plugins.find(p => p.name === name);
  $('#crumb').textContent = plugin?.label || name;
  view.innerHTML = '<div class="card"><div class="muted">Загрузка плагина…</div></div>';
  try {
    const [html, mod] = await Promise.all([
      fetch(`/p/${name}/view.html`).then(r => r.ok ? r.text() : Promise.reject(new Error(r.status))),
      import(`/p/${name}/view.js?t=${Date.now()}`),
    ]);
    view.innerHTML = html;
    if (typeof mod.default === 'function') {
      await mod.default(makeWP(name, view));
    }
  } catch (e) {
    view.innerHTML = `<div class="card"><h3>Ошибка загрузки плагина</h3><pre>${escapeHtml(e.message)}</pre></div>`;
  }
}

// ---------- Window.WP — SDK exposed to plugins ----------
function makeWP(pluginName, view) {
  const base = `/api/p/${pluginName}`;
  async function req(method, p, body) {
    const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(base + p, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(typeof data === 'object' ? (data.error || JSON.stringify(data)) : data);
    return data;
  }
  return {
    plugin: pluginName,
    view,
    api: {
      get:  (p)        => req('GET', p),
      post: (p, body)  => req('POST', p, body || {}),
      put:  (p, body)  => req('PUT', p, body || {}),
      del:  (p)        => req('DELETE', p),
    },
    toast,
    escapeHtml,
    openDrawer,
    closeDrawer,
    navigate,
    state,
  };
}

// ---------- Stats WS ----------
function connectStatsWs() {
  if (state.ws) try { state.ws.close(); } catch {}
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sid = state.activeServerId || '';
  const ws = new WebSocket(`${proto}://${location.host}/ws/stats?serverId=${sid}`);
  state.ws = ws;
  state.wsServerId = state.activeServerId;
  ws.onopen = () => updateWsStatus(true);
  ws.onclose = () => {
    updateWsStatus(false);
    // only auto-reconnect if user hasn't switched servers
    if (state.wsServerId === state.activeServerId) setTimeout(connectStatsWs, 3000);
  };
  ws.onerror = () => updateWsStatus(false);
  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'stats') applyStats(msg.data);
      else if (msg.type === 'error') toast('Стрим: ' + msg.message);
    } catch {}
  };
}
function updateWsStatus(on) {
  $('#ws-dot')?.classList.toggle('on', on);
  $('#ws-status') && ($('#ws-status').textContent = on ? 'live' : 'offline');
}

function applyStats(d) {
  // history
  state.history.cpu.push(d.cpu.load);
  state.history.mem.push((d.mem.used / d.mem.total) * 100);
  const rootDisk = d.disks.find(x => x.mount === '/') || d.disks[0];
  if (rootDisk) state.history.disk.push(rootDisk.use);
  const sumNet = d.net.reduce((a, n) => a + (n.rx_sec || 0) + (n.tx_sec || 0), 0);
  state.history.net.push(sumNet);
  for (const k of Object.keys(state.history)) {
    if (state.history[k].length > 60) state.history[k].shift();
  }

  // dashboard tiles
  if ($('#s-cpu')) $('#s-cpu').textContent = d.cpu.load.toFixed(1);
  if ($('#s-mem')) $('#s-mem').textContent = ((d.mem.used / d.mem.total) * 100).toFixed(1);
  if (rootDisk && $('#s-disk')) $('#s-disk').textContent = rootDisk.use.toFixed(1);
  if ($('#s-net')) {
    const rx = d.net.reduce((a, n) => a + (n.rx_sec || 0), 0);
    const tx = d.net.reduce((a, n) => a + (n.tx_sec || 0), 0);
    $('#s-net').textContent = `${fmtBps(rx)} / ${fmtBps(tx)}`;
  }

  drawSpark('spark-cpu', state.history.cpu, 100);
  drawSpark('spark-mem', state.history.mem, 100);
  drawSpark('spark-disk', state.history.disk, 100);
  drawSpark('spark-net', state.history.net);

  // disks table
  const dtb = $('#disks-table tbody');
  if (dtb) {
    dtb.innerHTML = d.disks.map(disk => `
      <tr>
        <td><code>${escapeHtml(disk.fs)}</code></td>
        <td>${escapeHtml(disk.mount)}</td>
        <td class="muted">${escapeHtml(disk.type || '')}</td>
        <td>${fmtBytes(disk.size)}</td>
        <td>${fmtBytes(disk.used)}</td>
        <td>${(disk.use || 0).toFixed(1)}%</td>
      </tr>`).join('');
  }

  // processes top
  const ptb = $('#proc-table tbody');
  if (ptb) {
    ptb.innerHTML = (d.processes.top || []).map(p => `
      <tr>
        <td><code>${p.pid}</code></td>
        <td>${escapeHtml(p.name)}</td>
        <td class="muted">${escapeHtml(p.user || '')}</td>
        <td>${(p.cpu || 0).toFixed(1)}</td>
        <td>${(p.mem || 0).toFixed(1)}</td>
        <td><button class="btn ghost small" data-kill="${p.pid}">kill</button></td>
      </tr>`).join('');
    ptb.onclick = async e => {
      const pid = e.target.dataset.kill;
      if (!pid) return;
      if (!confirm(`Завершить процесс ${pid}?`)) return;
      await api('/system/action', { method: 'POST', body: JSON.stringify({ action: 'kill', args: { pid } }) });
    };
  }
}

// ---------- Dashboard ----------
async function initDashboard() {
  const srv = state.servers.find(s => s.id === state.activeServerId);
  const isRemote = srv && !srv.is_local;
  // show which server is shown
  $('#crumb').textContent = 'Дашборд' + (srv ? ` — ${srv.name}` : '');
  // system info
  try {
    const sid = state.activeServerId || '';
    const s = await api('/system/static?serverId=' + sid);
    $('#sys-info').innerHTML = `
      <tr><td>Hostname</td><td>${escapeHtml(s.hostname)}</td></tr>
      <tr><td>OS</td><td>${escapeHtml(s.os)}</td></tr>
      <tr><td>Kernel</td><td>${escapeHtml(s.kernel)}</td></tr>
      <tr><td>Arch</td><td>${escapeHtml(s.arch)}</td></tr>
      <tr><td>CPU</td><td>${escapeHtml(s.cpu.brand)} (${s.cpu.cores}c / ${s.cpu.physicalCores}p, ${s.cpu.speed}GHz)</td></tr>
      <tr><td>System</td><td>${escapeHtml(s.system.manufacturer)} ${escapeHtml(s.system.model)}</td></tr>
      <tr><td>Memory</td><td>${fmtBytes(s.memTotal)}</td></tr>
    `;
  } catch {}

  $$('.actions [data-action]').forEach(b => {
    b.onclick = async () => {
      if (b.dataset.action === 'poweroff' && !confirm('Выключить сервер?')) return;
      if (b.dataset.action === 'reboot' && !confirm('Перезагрузить сервер?')) return;
      const r = await api('/system/action', { method: 'POST', body: JSON.stringify({ action: b.dataset.action }) });
      alert((r.ok ? 'OK\n' : 'Ошибка\n') + (r.stdout || r.stderr || ''));
    };
  });
}

// ---------- Servers CRUD ----------
async function initServers() {
  const tb = $('#servers-table tbody');
  tb.innerHTML = state.servers.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong>${s.is_local ? ' <span class="badge tag">local</span>' : ''}</td>
      <td><code>${escapeHtml(s.host)}</code></td>
      <td>${s.port}</td>
      <td>${escapeHtml(s.username)}</td>
      <td>${s.vnc_host || s.vnc_port ? `${escapeHtml(s.vnc_host || s.host)}:${s.vnc_port || 5900}` : '<span class="muted">—</span>'}</td>
      <td>${(s.tags || '').split(',').filter(Boolean).map(t => `<span class="badge tag">${escapeHtml(t.trim())}</span>`).join('')}</td>
      <td>
        <button class="btn ghost small" data-test="${s.id}">Тест</button>
        ${s.is_local ? '' : `<button class="btn ghost small" data-edit="${s.id}">✎</button>
        <button class="btn ghost small" data-del="${s.id}">✕</button>`}
      </td>
    </tr>`).join('');

  tb.onclick = async e => {
    const t = e.target;
    if (t.dataset.test) {
      t.textContent = '…';
      const r = await api(`/servers/${t.dataset.test}/test`, { method: 'POST' });
      alert((r.ok ? 'Подключение OK\n\n' : 'Ошибка\n\n') + (r.stdout || r.stderr || r.error || ''));
      t.textContent = 'Тест';
    } else if (t.dataset.edit) {
      openServerForm(state.servers.find(s => s.id == t.dataset.edit));
    } else if (t.dataset.del) {
      if (!confirm('Удалить сервер?')) return;
      await api('/servers/' + t.dataset.del, { method: 'DELETE' });
      await loadServers();
      navigate('#/servers');
    }
  };

  $('#add-server-btn').onclick = () => openServerForm();
  $('#server-cancel').onclick = () => ($('#server-modal').hidden = true);

  const form = $('#server-form');
  form.querySelector('[name=auth_type]').onchange = (e) => {
    const isKey = e.target.value === 'key';
    form.querySelector('.pw-field').hidden = isKey;
    form.querySelector('.key-field').hidden = !isKey;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    fd.port = parseInt(fd.port || '22', 10);
    fd.vnc_port = fd.vnc_port ? parseInt(fd.vnc_port, 10) : null;
    const id = form.dataset.id;
    if (id) {
      await api('/servers/' + id, { method: 'PUT', body: JSON.stringify(fd) });
    } else {
      await api('/servers', { method: 'POST', body: JSON.stringify(fd) });
    }
    $('#server-modal').hidden = true;
    await loadServers();
    navigate('#/servers');
  };
}

function openServerForm(server) {
  const modal = $('#server-modal');
  const form = $('#server-form');
  form.reset();
  form.dataset.id = '';
  $('#server-form-title').textContent = server ? 'Редактировать сервер' : 'Новый сервер';
  if (server) {
    form.dataset.id = server.id;
    for (const [k, v] of Object.entries(server)) {
      if (form.elements[k]) form.elements[k].value = v ?? '';
    }
  }
  const isKey = form.elements.auth_type.value === 'key';
  form.querySelector('.pw-field').hidden = isKey;
  form.querySelector('.key-field').hidden = !isKey;
  modal.hidden = false;
}

// ---------- Terminal ----------
let termInstance = null;
let termWs = null;
let termSticky = { ctrl: false, alt: false, shift: false };

const TERM_KEYS = [
  // Sticky modifiers
  { id: 'ctrl', label: 'Ctrl', sticky: true },
  { id: 'alt',  label: 'Alt',  sticky: true },
  { id: 'shift',label: 'Shift',sticky: true },
  { sep: true },
  // Single keys
  { send: '\x1b',    label: 'Esc' },
  { send: '\t',      label: 'Tab' },
  { send: '\x7f',    label: '⌫' },
  { sep: true },
  // Arrows
  { send: '\x1b[A',  label: '↑' },
  { send: '\x1b[B',  label: '↓' },
  { send: '\x1b[D',  label: '←' },
  { send: '\x1b[C',  label: '→' },
  { sep: true },
  // Navigation
  { send: '\x1b[H',  label: 'Home' },
  { send: '\x1b[F',  label: 'End'  },
  { send: '\x1b[5~', label: 'PgUp' },
  { send: '\x1b[6~', label: 'PgDn' },
  { sep: true },
  // Common combos
  { send: '\x03',    label: '^C',  wide: true, title: 'Ctrl+C — прервать' },
  { send: '\x04',    label: '^D',  wide: true, title: 'Ctrl+D — EOF/выход' },
  { send: '\x0c',    label: '^L',  wide: true, title: 'Ctrl+L — очистить экран' },
  { send: '\x1a',    label: '^Z',  wide: true, title: 'Ctrl+Z — пауза' },
  { sep: true },
  // Nano save/exit
  { send: '\x0f',    label: '^O',  wide: true, title: 'Ctrl+O — сохранить (nano)' },
  { send: '\x18',    label: '^X',  wide: true, title: 'Ctrl+X — выйти (nano)' },
  { send: '\x17',    label: '^W',  wide: true, title: 'Ctrl+W — поиск (nano)' },
  { send: '\x0b',    label: '^K',  wide: true, title: 'Ctrl+K — вырезать строку' },
  { send: '\x15',    label: '^U',  wide: true, title: 'Ctrl+U — вставить строку' },
  { sep: true },
  // Function keys
  { send: '\x1bOP',  label: 'F1' },
  { send: '\x1bOQ',  label: 'F2' },
  { send: '\x1bOR',  label: 'F3' },
  { send: '\x1bOS',  label: 'F4' },
  { send: '\x1b[15~',label: 'F5' },
  { send: '\x1b[17~',label: 'F6' },
  { send: '\x1b[18~',label: 'F7' },
  { send: '\x1b[19~',label: 'F8' },
  { send: '\x1b[20~',label: 'F9' },
  { send: '\x1b[21~',label: 'F10' },
  { send: '\x1b[24~',label: 'F12' },
];

function termSendRaw(data) {
  if (termWs && termWs.readyState === WebSocket.OPEN) termWs.send(data);
}

// Apply sticky modifiers to a regular character: e.g. Ctrl+A -> \x01
function applyStickyToChar(ch) {
  let out = ch;
  if (termSticky.ctrl) {
    const code = ch.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64);
    else if (code === 32) out = '\x00'; // Ctrl+Space
    else if (ch.length === 1 && /[a-z]/i.test(ch)) out = String.fromCharCode((code & 0x1f));
  }
  if (termSticky.alt) out = '\x1b' + out;
  // Shift on letters: uppercase
  if (termSticky.shift && /^[a-z]$/.test(out)) out = out.toUpperCase();
  return out;
}

function termConsumeSticky() {
  let used = false;
  for (const k of ['ctrl','alt','shift']) {
    if (termSticky[k]) { termSticky[k] = false; used = true; }
  }
  if (used) renderTermKeysState();
}

function renderTermKeysState() {
  $$('#term-keys .tk.sticky').forEach(el => {
    el.classList.toggle('on', !!termSticky[el.dataset.mod]);
  });
}

function buildTermKeysBar() {
  const host = $('#term-keys');
  if (!host) return;
  host.innerHTML = TERM_KEYS.map((k, i) => {
    if (k.sep) return `<span class="tk sep"></span>`;
    if (k.sticky) return `<button type="button" class="tk sticky" data-mod="${k.id}" title="${k.label} (sticky)">${k.label}</button>`;
    const cls = 'tk' + (k.wide ? ' wide' : '');
    return `<button type="button" class="${cls}" data-i="${i}" title="${escapeHtml(k.title || k.label)}">${escapeHtml(k.label)}</button>`;
  }).join('');
  host.onclick = e => {
    const btn = e.target.closest('.tk');
    if (!btn) return;
    if (btn.classList.contains('sticky')) {
      const m = btn.dataset.mod;
      termSticky[m] = !termSticky[m];
      renderTermKeysState();
      return;
    }
    const i = btn.dataset.i;
    if (i === undefined) return;
    const k = TERM_KEYS[i];
    if (!k?.send) return;
    let data = k.send;
    // For Esc and arrows we still allow modifiers if user wants
    if (termSticky.alt && k.send === '\x1b') {
      // Esc with Alt: just Esc twice doesn't make sense; skip combo
    }
    termSendRaw(data);
    // also focus terminal so subsequent typing goes there
    termInstance?.focus();
    termConsumeSticky();
  };
}

function initTerminal() {
  const srv = state.servers.find(s => s.id === state.activeServerId);
  $('#term-server-name').textContent = srv?.name || '—';
  buildTermKeysBar();
  connectTerminal();
  $('#term-reconnect').onclick = connectTerminal;
  $('#term-clear').onclick = () => termInstance?.clear();
  $('#term-copy').onclick = async () => {
    const sel = termInstance?.getSelection();
    if (!sel) return toast('Нет выделения');
    try { await navigator.clipboard.writeText(sel); toast('Скопировано'); }
    catch { toast('Не удалось скопировать'); }
  };
  $('#term-paste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); termSendRaw(t); }
    catch { toast('Не удалось прочитать буфер'); }
  };
}

function connectTerminal() {
  if (termWs) try { termWs.close(); } catch {}
  if (termInstance) { termInstance.dispose(); termInstance = null; }

  const el = $('#terminal');
  if (!el) return;
  el.innerHTML = '';
  const term = new Terminal({
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    theme: { background: '#000000', foreground: '#ededed', cursor: '#ffffff' },
    cursorBlink: true,
    convertEol: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  fit.fit();
  termInstance = term;
  const onResize = () => { try { fit.fit(); } catch {} };
  window.addEventListener('resize', onResize);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?serverId=${state.activeServerId}&cols=${term.cols}&rows=${term.rows}`);
  ws.binaryType = 'arraybuffer';
  termWs = ws;

  ws.onopen = () => term.write('\x1b[2m[connected]\x1b[0m\r\n');
  ws.onmessage = ev => {
    const data = typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data);
    term.write(typeof data === 'string' ? data : new TextDecoder().decode(data));
  };
  ws.onclose = () => term.write('\r\n\x1b[2m[disconnected]\x1b[0m\r\n');

  term.onData(d => {
    if (ws.readyState !== ws.OPEN) return;
    // Apply sticky modifiers to single-char input
    if ((termSticky.ctrl || termSticky.alt || termSticky.shift) && d.length === 1) {
      ws.send(applyStickyToChar(d));
      termConsumeSticky();
    } else {
      ws.send(d);
    }
  });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ resize: { cols, rows } }));
  });
}

// ---------- VNC ----------
let rfb = null;
async function initVnc() {
  const srv = state.servers.find(s => s.id === state.activeServerId);
  $('#vnc-server-name').textContent = srv?.name || '—';
  $('#vnc-reconnect').onclick = connectVnc;
  $('#vnc-fullscreen').onclick = () => $('#vnc-screen').requestFullscreen?.();
  connectVnc();
}
async function connectVnc() {
  const srv = state.servers.find(s => s.id === state.activeServerId);
  const status = $('#vnc-status');
  const screen = $('#vnc-screen');
  screen.innerHTML = '';
  if (!srv) { status.textContent = 'Нет активного сервера'; return; }

  try {
    const RFB = (await import('/vendor/novnc/core/rfb.js')).default;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/vnc?serverId=${srv.id}`;
    if (rfb) { try { rfb.disconnect(); } catch {} rfb = null; }
    rfb = new RFB(screen, url, {
      credentials: { password: srv.vnc_password || '' },
    });
    rfb.viewOnly = false;
    rfb.scaleViewport = true;
    rfb.addEventListener('connect', () => { status.textContent = 'Подключено'; });
    rfb.addEventListener('disconnect', e => { status.textContent = 'Отключено: ' + (e.detail?.reason || 'OK'); });
    rfb.addEventListener('securityfailure', e => { status.textContent = 'Ошибка авторизации VNC'; });
    rfb.addEventListener('credentialsrequired', () => {
      const pass = prompt('VNC пароль:');
      rfb.sendCredentials({ password: pass });
    });
    status.textContent = 'Подключение…';
  } catch (e) {
    status.textContent = 'Не удалось загрузить noVNC: ' + e.message;
  }
}

// ---------- Services ----------
async function initServices() {
  const tb = $('#svc-table tbody');
  let list = [];
  const fetchList = async () => {
    const type = $('#svc-type').value;
    const state = $('#svc-state').value;
    list = await api(`/sd/units?type=${type}&state=${state}`);
    render();
  };
  const render = () => {
    const filter = $('#svc-filter').value.toLowerCase();
    const rows = list.filter(s => !filter || s.name.toLowerCase().includes(filter));
    tb.innerHTML = rows.map(s => `
      <tr data-svc="${escapeHtml(s.name)}">
        <td><code>${escapeHtml(s.name)}</code></td>
        <td class="muted small">${escapeHtml(s.load || '')}</td>
        <td><span class="badge ${s.active === 'active' ? 'on' : 'off'}">${escapeHtml(s.active || '')}</span></td>
        <td class="muted small">${escapeHtml(s.sub || '')}</td>
        <td class="muted">${escapeHtml(s.description || '')}</td>
        <td><button class="btn ghost small" data-svc-open="${escapeHtml(s.name)}">→</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Нет данных</td></tr>';
  };
  await fetchList();
  $('#svc-state').onchange = fetchList;
  $('#svc-type').onchange = fetchList;
  $('#svc-filter').oninput = render;
  $('#svc-daemon-reload').onclick = async () => {
    const r = await api('/sd/daemon-reload', { method: 'POST' });
    toast(r.ok ? 'daemon-reload OK' : 'Ошибка: ' + (r.stderr || ''));
    fetchList();
  };
  tb.onclick = e => {
    const name = e.target.closest('[data-svc-open]')?.dataset.svcOpen
              || e.target.closest('tr[data-svc]')?.dataset.svc;
    if (name) openServiceDrawer(name);
  };
}

async function openServiceDrawer(name) {
  openDrawer(name, '<div class="muted">Загрузка…</div>');
  const [status, logs, show] = await Promise.all([
    api(`/sd/units/${encodeURIComponent(name)}/status`),
    api(`/sd/units/${encodeURIComponent(name)}/logs?lines=200`),
    api(`/sd/units/${encodeURIComponent(name)}/show`),
  ]);
  const props = show || {};
  const html = `
    <div class="drawer-actions">
      ${['start','stop','restart','reload','enable','disable'].map(op =>
        `<button class="btn small" data-op="${op}">${op}</button>`).join('')}
    </div>
    <h4 class="muted small">Статус</h4>
    <pre>${escapeHtml(status.output || '')}</pre>
    <div class="kv-list">
      <div class="k">Description</div><div>${escapeHtml(props.Description || '')}</div>
      <div class="k">LoadState</div><div>${escapeHtml(props.LoadState || '')}</div>
      <div class="k">ActiveState</div><div>${escapeHtml(props.ActiveState || '')}</div>
      <div class="k">SubState</div><div>${escapeHtml(props.SubState || '')}</div>
      <div class="k">UnitFileState</div><div>${escapeHtml(props.UnitFileState || '')}</div>
      <div class="k">MainPID</div><div>${escapeHtml(props.MainPID || '')}</div>
      <div class="k">FragmentPath</div><div><code>${escapeHtml(props.FragmentPath || '')}</code></div>
    </div>
    <h4 class="muted small" style="margin-top:14px">Журнал (последние 200 строк)</h4>
    <pre>${escapeHtml(logs.output || '')}</pre>
  `;
  $('#drawer-body').innerHTML = html;
  $$('#drawer-body .drawer-actions [data-op]').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      const r = await api(`/sd/units/${encodeURIComponent(name)}/action`, {
        method: 'POST',
        body: JSON.stringify({ op: b.dataset.op }),
      });
      toast(r.ok ? `${b.dataset.op}: OK` : 'Ошибка: ' + (r.stderr || r.error || ''));
      b.disabled = false;
      openServiceDrawer(name); // refresh
    };
  });
}

// ---------- Processes ----------
async function initProcesses() {
  const tb = $('#proc-full-table tbody');
  const filter = () => $('#proc-filter')?.value?.toLowerCase() || '';
  const render = (live) => {
    const procs = (live?.processes?.top || []).filter(p => p.name.toLowerCase().includes(filter()));
    tb.innerHTML = procs.map(p => `
      <tr>
        <td><code>${p.pid}</code></td>
        <td>${escapeHtml(p.name)}</td>
        <td class="muted">${escapeHtml(p.user || '')}</td>
        <td>${(p.cpu || 0).toFixed(1)}</td>
        <td>${(p.mem || 0).toFixed(1)}</td>
        <td class="muted small"><code>${escapeHtml((p.command || '').slice(0, 80))}</code></td>
        <td><button class="btn ghost small" data-kill="${p.pid}">kill</button></td>
      </tr>`).join('');
  };
  const live = await api('/system/live');
  render(live);
  $('#proc-filter').oninput = () => render(live);
  tb.onclick = async e => {
    const pid = e.target.dataset.kill;
    if (!pid) return;
    if (!confirm(`Завершить процесс ${pid}?`)) return;
    await api('/system/action', { method: 'POST', body: JSON.stringify({ action: 'kill', args: { pid } }) });
    const fresh = await api('/system/live');
    render(fresh);
  };
}

// ---------- Docker ----------
async function initDocker() {
  const info = await api('/dk/info');
  if (!info.available) {
    $('#docker-summary').textContent = 'Docker не обнаружен или нет прав доступа.';
    return;
  }
  $('#docker-summary').innerHTML = `<div>Docker <strong>${escapeHtml(info.version)}</strong> · готово к работе</div>`;

  let containers = [];
  let images = [];

  const renderContainers = () => {
    const filter = $('#dk-filter').value.toLowerCase();
    const rows = containers.filter(c => !filter ||
      (c.name + ' ' + c.image).toLowerCase().includes(filter));
    $('#docker-table tbody').innerHTML = rows.map(c => `
      <tr data-id="${escapeHtml(c.id)}">
        <td><strong>${escapeHtml(c.name || '')}</strong><br><code class="muted small">${escapeHtml(c.id?.slice(0,12) || '')}</code></td>
        <td class="muted">${escapeHtml(c.image || '')}</td>
        <td><span class="badge ${c.state === 'running' ? 'on' : 'off'}">${escapeHtml(c.state || '')}</span><br><span class="muted small">${escapeHtml(c.status || '')}</span></td>
        <td class="muted small">${escapeHtml(c.ports || '')}</td>
        <td>
          ${c.state === 'running'
            ? `<button class="btn ghost small" data-op="stop">stop</button>
               <button class="btn ghost small" data-op="restart">restart</button>`
            : `<button class="btn ghost small" data-op="start">start</button>`}
          <button class="btn ghost small" data-op="open">→</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Нет контейнеров</td></tr>';
  };

  const renderImages = () => {
    $('#images-table tbody').innerHTML = images.map(i => `
      <tr>
        <td>${escapeHtml(i.repository || '')}</td>
        <td class="muted">${escapeHtml(i.tag || '')}</td>
        <td><code>${escapeHtml(i.id?.slice(0,12) || '')}</code></td>
        <td>${escapeHtml(i.size || '')}</td>
        <td class="muted">${escapeHtml(i.created || '')}</td>
        <td><button class="btn ghost small" data-img-del="${escapeHtml(i.id)}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Нет образов</td></tr>';
  };

  const reload = async () => {
    [containers, images] = await Promise.all([api('/dk/containers'), api('/dk/images')]);
    renderContainers(); renderImages();
  };

  await reload();

  $('#dk-filter').oninput = renderContainers;

  $('#docker-table tbody').onclick = async e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    const op = e.target.dataset.op;
    if (!op) return;
    if (op === 'open') return openContainerDrawer(id);
    const r = await api(`/dk/containers/${id}/action`, { method: 'POST', body: JSON.stringify({ op }) });
    toast(r.ok ? `${op}: OK` : 'Ошибка: ' + (r.stderr || r.error || ''));
    reload();
  };

  $('#images-table tbody').onclick = async e => {
    const id = e.target.dataset.imgDel;
    if (!id) return;
    if (!confirm('Удалить образ?')) return;
    const r = await api(`/dk/images/${id}`, { method: 'DELETE' });
    toast(r.ok ? 'Образ удалён' : 'Ошибка: ' + (r.stderr || ''));
    reload();
  };

  $('#pull-form').onsubmit = async e => {
    e.preventDefault();
    const img = e.target.elements.image.value.trim();
    toast(`Pull ${img}…`);
    const r = await api('/dk/images/pull', { method: 'POST', body: JSON.stringify({ image: img }) });
    toast(r.ok ? `Pull OK: ${img}` : 'Ошибка: ' + (r.stderr || ''));
    e.target.elements.image.value = '';
    reload();
  };

  $$('#docker-info [data-prune]').forEach(b => {
    b.onclick = async () => {
      if (!confirm(`docker ${b.dataset.prune} prune?`)) return;
      const r = await api('/dk/prune', { method: 'POST', body: JSON.stringify({ target: b.dataset.prune }) });
      toast(r.ok ? 'Prune OK' : 'Ошибка: ' + (r.stderr || ''));
      reload();
    };
  });
}

async function openContainerDrawer(id) {
  openDrawer('Container ' + id.slice(0, 12), '<div class="muted">Загрузка…</div>');
  const [logs, inspect, stats] = await Promise.all([
    api(`/dk/containers/${id}/logs?lines=300`),
    api(`/dk/containers/${id}/inspect`),
    api(`/dk/containers/${id}/stats`).catch(() => null),
  ]);
  const cfg = inspect?.Config || {};
  const state = inspect?.State || {};
  const html = `
    <div class="drawer-actions">
      ${['start','stop','restart','pause','unpause','kill'].map(op =>
        `<button class="btn small" data-op="${op}">${op}</button>`).join('')}
      <button class="btn danger small" data-op="rm">remove</button>
    </div>
    <h4 class="muted small">Состояние</h4>
    <div class="kv-list">
      <div class="k">Name</div><div>${escapeHtml(inspect?.Name || '')}</div>
      <div class="k">Image</div><div>${escapeHtml(cfg.Image || '')}</div>
      <div class="k">Status</div><div>${escapeHtml(state.Status || '')} (exit=${state.ExitCode ?? ''})</div>
      <div class="k">StartedAt</div><div>${escapeHtml(state.StartedAt || '')}</div>
      <div class="k">CPU/MEM</div><div>${stats ? `${escapeHtml(stats.cpu)} / ${escapeHtml(stats.mem)} (${escapeHtml(stats.memPerc)})` : '—'}</div>
      <div class="k">Net I/O</div><div>${stats ? escapeHtml(stats.net) : '—'}</div>
      <div class="k">Cmd</div><div><code>${escapeHtml((cfg.Cmd || []).join(' '))}</code></div>
      <div class="k">Env</div><div><code class="small">${escapeHtml((cfg.Env || []).join('\n'))}</code></div>
    </div>
    <h4 class="muted small" style="margin-top:14px">Логи (300 строк)</h4>
    <pre>${escapeHtml(logs.output || '')}</pre>
  `;
  $('#drawer-body').innerHTML = html;
  $$('#drawer-body .drawer-actions [data-op]').forEach(b => {
    b.onclick = async () => {
      if (b.dataset.op === 'rm' && !confirm('Удалить контейнер?')) return;
      b.disabled = true;
      const r = await api(`/dk/containers/${id}/action`, { method: 'POST', body: JSON.stringify({ op: b.dataset.op }) });
      toast(r.ok ? `${b.dataset.op}: OK` : 'Ошибка: ' + (r.stderr || r.error || ''));
      if (b.dataset.op === 'rm') { closeDrawer(); navigate('#/docker'); }
      else openContainerDrawer(id);
    };
  });
}

// ---------- Profile / 2FA ----------
async function initProfile() {
  const me = (await api('/auth/me')).user;
  state.user = me;
  $('#prof-username').textContent = me.username;
  $('#prof-role').textContent = me.role;
  const en = !!me.totp_enabled;
  $('#prof-2fa-status').innerHTML = en
    ? '<span class="badge on">включена</span>'
    : '<span class="badge off">выключена</span>';
  $('#totp-disabled').hidden = en;
  $('#totp-enabled').hidden = !en;

  $('#totp-enroll').onclick = async () => {
    const r = await api('/users/me/totp/enroll', { method: 'POST' });
    $('#totp-disabled').hidden = true;
    $('#totp-enroll-step').hidden = false;
    $('#totp-secret').textContent = r.secret;
    // Generate QR with qrcode-generator
    const qr = qrcode(0, 'M'); qr.addData(r.uri); qr.make();
    const c = $('#totp-qr'); const ctx = c.getContext('2d');
    const size = qr.getModuleCount(); const cell = Math.floor(c.width / size);
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < size; r++) for (let col = 0; col < size; col++) {
      if (qr.isDark(r, col)) ctx.fillRect(col*cell, r*cell, cell, cell);
    }
  };
  $('#totp-cancel').onclick = () => { $('#totp-enroll-step').hidden = true; $('#totp-disabled').hidden = false; };
  $('#totp-confirm').onsubmit = async (e) => {
    e.preventDefault();
    const code = new FormData(e.target).get('code');
    try {
      await api('/users/me/totp/confirm', { method: 'POST', body: JSON.stringify({ code }) });
      toast('2FA включена ✅');
      initProfile();
    } catch (err) { toast('Неверный код: ' + err.message); }
  };
  $('#totp-disable-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = new FormData(e.target).get('code');
    try {
      await api('/users/me/totp/disable', { method: 'POST', body: JSON.stringify({ code }) });
      toast('2FA отключена');
      initProfile();
    } catch (err) { toast('Ошибка: ' + err.message); }
  };
}

// ---------- Users (admin) ----------
async function initUsers() {
  const tb = $('#users-table tbody');
  const reload = async () => {
    const users = await api('/users');
    tb.innerHTML = users.map(u => `
      <tr>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td><span class="badge tag">${u.role}</span></td>
        <td>${u.totp_enabled ? '<span class="badge on">on</span>' : '<span class="muted small">—</span>'}</td>
        <td class="muted small">${new Date(u.created_at).toLocaleString()}</td>
        <td>
          <button class="btn ghost small" data-edit='${escapeHtml(JSON.stringify(u))}'>✎</button>
          <button class="btn ghost small" data-del="${u.id}">✕</button>
        </td>
      </tr>`).join('');
    tb.onclick = async (e) => {
      if (e.target.dataset.del) {
        if (!confirm('Удалить пользователя?')) return;
        try { await api('/users/' + e.target.dataset.del, { method: 'DELETE' }); reload(); }
        catch (err) { toast('Ошибка: ' + err.message); }
      } else if (e.target.dataset.edit) {
        openUserForm(JSON.parse(e.target.dataset.edit));
      }
    };
  };
  await reload();
  $('#user-add').onclick = () => openUserForm();
  $('#user-cancel').onclick = () => ($('#user-modal').hidden = true);
  $('#user-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const id = e.target.dataset.id;
    try {
      if (id) {
        const body = { role: fd.role };
        if (fd.password) body.password = fd.password;
        await api('/users/' + id, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/users', { method: 'POST', body: JSON.stringify(fd) });
      }
      $('#user-modal').hidden = true;
      reload();
    } catch (err) { toast('Ошибка: ' + err.message); }
  };
}
function openUserForm(user) {
  const form = $('#user-form');
  form.reset();
  form.dataset.id = '';
  $('#user-form-title').textContent = user ? `Редактирование: ${user.username}` : 'Новый пользователь';
  if (user) {
    form.dataset.id = user.id;
    form.elements.username.value = user.username;
    form.elements.username.disabled = true;
    form.elements.role.value = user.role;
  } else {
    form.elements.username.disabled = false;
  }
  $('#user-modal').hidden = false;
}

// ---------- Audit log ----------
async function initAudit() {
  const list = await api('/audit?limit=300');
  const tb = $('#audit-table tbody');
  const render = (q = '') => {
    tb.innerHTML = list
      .filter(r => !q || (r.username + ' ' + r.action + ' ' + (r.details || '')).toLowerCase().includes(q.toLowerCase()))
      .map(r => `
        <tr>
          <td class="muted small">${new Date(r.created_at).toLocaleString()}</td>
          <td>${escapeHtml(r.username || '—')}</td>
          <td><code>${escapeHtml(r.action)}</code></td>
          <td class="muted small"><code>${escapeHtml(r.details || '')}</code></td>
        </tr>`).join('');
  };
  render();
  $('#audit-filter').oninput = (e) => render(e.target.value);
}

// ---------- Helpers ----------
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB','PB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtBps(n) {
  if (!n || n < 0) return '0 B/s';
  return fmtBytes(n) + '/s';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function drawSpark(id, arr, max) {
  const c = document.getElementById(id);
  if (!c || !arr.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,w,h);
  const localMax = max ?? Math.max(...arr, 1);
  const step = w / Math.max(arr.length - 1, 1);
  ctx.lineWidth = 1.5;
  // Gradient stroke
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#f38020');
  grad.addColorStop(1, '#ffffff');
  ctx.strokeStyle = grad;
  ctx.beginPath();
  arr.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / localMax) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // fill
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
  fillGrad.addColorStop(0, 'rgba(243,128,32,.18)');
  fillGrad.addColorStop(1, 'rgba(243,128,32,0)');
  ctx.fillStyle = fillGrad;
  ctx.fill();
}

// ---------- Drawer ----------
function openDrawer(title, body) {
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = body || '';
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  requestAnimationFrame(() => $('#drawer').classList.add('open'));
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer-backdrop').hidden = true;
  setTimeout(() => { $('#drawer').hidden = true; }, 200);
}

// ---------- Toast ----------
function toast(msg, ms = 2500) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.style.cssText = 'position:fixed;bottom:18px;right:18px;display:flex;flex-direction:column;gap:8px;z-index:80;pointer-events:none';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'background:#18181b;border:1px solid #27272a;color:#ededed;padding:10px 14px;border-radius:8px;font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.5);max-width:360px;pointer-events:auto;animation:fadein .15s ease;';
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .2s'; setTimeout(() => t.remove(), 200); }, ms);
}

// ---------- Sidebar toggle ----------
function toggleSidebar(open) {
  const sb = $('.sidebar');
  const bd = $('#sidebar-backdrop');
  const on = open ?? !sb.classList.contains('open');
  sb.classList.toggle('open', on);
  bd.classList.toggle('open', on);
}

// ---------- Command palette ----------
const COMMANDS = [
  { id: 'go-dashboard', label: 'Перейти: Дашборд',   run: () => location.hash = '#/dashboard' },
  { id: 'go-servers',   label: 'Перейти: Серверы',   run: () => location.hash = '#/servers' },
  { id: 'go-terminal',  label: 'Перейти: Терминал',  run: () => location.hash = '#/terminal' },
  { id: 'go-vnc',       label: 'Перейти: VNC',       run: () => location.hash = '#/vnc' },
  { id: 'go-services',  label: 'Перейти: Сервисы',   run: () => location.hash = '#/services' },
  { id: 'go-processes', label: 'Перейти: Процессы',  run: () => location.hash = '#/processes' },
  { id: 'go-docker',    label: 'Перейти: Docker',    run: () => location.hash = '#/docker' },
  { id: 'reboot',       label: 'Сервер: Перезагрузить', run: async () => {
      if (!confirm('Перезагрузить?')) return;
      await api('/system/action', { method:'POST', body: JSON.stringify({action:'reboot'})});
      toast('Reboot запланирован');
  }},
  { id: 'poweroff',     label: 'Сервер: Выключить', run: async () => {
      if (!confirm('Выключить?')) return;
      await api('/system/action', { method:'POST', body: JSON.stringify({action:'poweroff'})});
      toast('Poweroff запланирован');
  }},
  { id: 'cancel-shutdown', label: 'Сервер: Отменить shutdown', run: async () => {
      await api('/system/action', { method:'POST', body: JSON.stringify({action:'cancel-shutdown'})});
      toast('Shutdown отменён');
  }},
  { id: 'daemon-reload', label: 'Systemd: daemon-reload', run: async () => {
      const r = await api('/sd/daemon-reload', { method:'POST' });
      toast(r.ok ? 'daemon-reload OK' : 'Ошибка');
  }},
  { id: 'add-server',   label: 'Серверы: Добавить новый', run: () => { location.hash = '#/servers'; setTimeout(() => $('#add-server-btn')?.click(), 100); }},
  { id: 'logout',       label: 'Выйти из панели', run: async () => { await api('/auth/logout', {method:'POST'}); location.reload(); }},
];

let paletteSelected = 0;
function openPalette() {
  $('#palette').hidden = false;
  $('#palette-input').value = '';
  paletteSelected = 0;
  renderPalette('');
  setTimeout(() => $('#palette-input').focus(), 10);
}
function closePalette() { $('#palette').hidden = true; }
function renderPalette(q) {
  const qLower = q.toLowerCase();
  const items = COMMANDS.filter(c => c.label.toLowerCase().includes(qLower));
  const list = $('#palette-list');
  list.innerHTML = items.map((c, i) => `
    <li class="${i === paletteSelected ? 'sel' : ''}" data-id="${c.id}">
      <span>${escapeHtml(c.label)}</span><span class="kbd">↵</span>
    </li>
  `).join('') || '<li class="muted">Ничего не найдено</li>';
  list.onclick = e => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    const cmd = COMMANDS.find(c => c.id === id);
    closePalette(); cmd?.run();
  };
}
$('#palette-input').addEventListener('input', e => { paletteSelected = 0; renderPalette(e.target.value); });
$('#palette-input').addEventListener('keydown', e => {
  const items = COMMANDS.filter(c => c.label.toLowerCase().includes(e.target.value.toLowerCase()));
  if (e.key === 'ArrowDown') { paletteSelected = Math.min(paletteSelected + 1, items.length - 1); renderPalette(e.target.value); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { paletteSelected = Math.max(paletteSelected - 1, 0); renderPalette(e.target.value); e.preventDefault(); }
  else if (e.key === 'Enter') { const c = items[paletteSelected]; if (c) { closePalette(); c.run(); } }
  else if (e.key === 'Escape') closePalette();
});
$('#palette').addEventListener('click', e => { if (e.target.id === 'palette') closePalette(); });

// ---------- Hotkeys ----------
let gPressed = false; let gTimer = null;
function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'SELECT');
}
window.addEventListener('keydown', e => {
  // Always-on: Ctrl/Cmd+K, Escape
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#palette').hidden) { closePalette(); return; }
    if (!$('#help-modal').hidden) { $('#help-modal').hidden = true; return; }
    if (!$('#server-modal')?.hidden) { $('#server-modal').hidden = true; return; }
    if (!$('#drawer').hidden) { closeDrawer(); return; }
    if ($('.sidebar')?.classList.contains('open')) { toggleSidebar(false); return; }
  }
  // skip when typing
  if (isTyping(document.activeElement)) return;

  if (e.key === '?') { $('#help-modal').hidden = false; return; }
  if (e.key === '/') {
    e.preventDefault();
    const f = $('#svc-filter') || $('#proc-filter') || $('#dk-filter');
    f?.focus();
    return;
  }
  if (e.key.toLowerCase() === 'r') { navigate(location.hash); toast('Обновлено'); return; }
  if (e.key.toLowerCase() === 'm') { toggleSidebar(); return; }

  // g + X navigation
  if (e.key.toLowerCase() === 'g' && !gPressed) {
    gPressed = true;
    clearTimeout(gTimer);
    gTimer = setTimeout(() => { gPressed = false; }, 1200);
    return;
  }
  if (gPressed) {
    gPressed = false;
    clearTimeout(gTimer);
    const map = { d: 'dashboard', s: 'servers', t: 'terminal', v: 'vnc', e: 'services', p: 'processes', k: 'docker' };
    const route = map[e.key.toLowerCase()];
    if (route) { location.hash = '#/' + route; e.preventDefault(); }
  }
});

// Wire static UI
$('#menu-btn')?.addEventListener('click', () => toggleSidebar());
$('#sidebar-backdrop')?.addEventListener('click', () => toggleSidebar(false));
$$('.sidebar nav a').forEach(a => a.addEventListener('click', () => { if (window.innerWidth <= 900) toggleSidebar(false); }));
$('#palette-btn')?.addEventListener('click', openPalette);
$('#help-btn')?.addEventListener('click', () => { $('#help-modal').hidden = false; });
$('#help-close')?.addEventListener('click', () => { $('#help-modal').hidden = true; });
$('#drawer-close')?.addEventListener('click', closeDrawer);
$('#drawer-backdrop')?.addEventListener('click', closeDrawer);

// ---------- Entry ----------
(async function main() {
  if (await checkAuth()) {
    showApp();
    await boot();
  } else {
    showLogin();
  }
})();
