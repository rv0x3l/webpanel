export default async function init(WP) {
  const view = WP.view;
  let cwd = '/';

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B','KB','MB','GB','TB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function joinPath(a, b) {
    if (b === '..') return a.replace(/\/[^/]+\/?$/, '') || '/';
    if (b.startsWith('/')) return b;
    return (a.endsWith('/') ? a : a + '/') + b;
  }

  async function load(p) {
    cwd = p;
    view.querySelector('#fm-cwd').textContent = p;
    view.querySelector('#fm-path').value = p;
    const list = view.querySelector('#fm-list');
    list.innerHTML = '<div class="muted" style="padding:14px">…</div>';
    try {
      const r = await WP.api.get('/list?path=' + encodeURIComponent(p));
      list.innerHTML = '';
      const items = r.items;
      const ul = document.createElement('div');
      ul.style.padding = '6px';
      items.forEach(it => {
        const row = document.createElement('div');
        row.className = 'fm-item';
        row.style.cssText = 'padding:8px 10px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px';
        const icon = it.type === 'dir' ? '📁' : it.type === 'link' ? '🔗' : '📄';
        row.innerHTML = `<span>${icon}</span><span style="flex:1">${WP.escapeHtml(it.name)}</span>
          <span class="muted small">${it.type === 'dir' ? '' : fmtBytes(it.size)}</span>
          <button class="btn ghost small" data-act="del" data-name="${WP.escapeHtml(it.name)}" title="Удалить">✕</button>`;
        row.onmouseenter = () => row.style.background = 'var(--bg-3)';
        row.onmouseleave = () => row.style.background = '';
        row.onclick = (e) => {
          if (e.target.closest('[data-act]')) return;
          if (it.type === 'dir') load(joinPath(cwd, it.name));
          else openFile(joinPath(cwd, it.name));
        };
        row.querySelector('[data-act=del]').onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`Удалить «${it.name}»?`)) return;
          try { await WP.api.del('/delete?path=' + encodeURIComponent(joinPath(cwd, it.name))); load(cwd); }
          catch (e) { WP.toast('Ошибка: ' + e.message); }
        };
        ul.appendChild(row);
      });
      list.appendChild(ul);
    } catch (e) {
      list.innerHTML = `<div class="error" style="padding:14px">${WP.escapeHtml(e.message)}</div>`;
    }
  }

  async function openFile(p) {
    const pane = view.querySelector('#fm-pane');
    pane.innerHTML = '<div class="muted">…</div>';
    try {
      const r = await WP.api.get('/read?path=' + encodeURIComponent(p));
      if (r.binary) {
        pane.innerHTML = `
          <h4 style="margin:0 0 8px">${WP.escapeHtml(p)}</h4>
          <div class="muted small">Двоичный файл, ${fmtBytes(r.size)}</div>
          <p><a class="btn ghost small" href="/api/p/filemanager/download?path=${encodeURIComponent(p)}" download>↓ Скачать</a></p>`;
        return;
      }
      pane.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <h4 style="margin:0;word-break:break-all">${WP.escapeHtml(p)}</h4>
          <div style="display:flex;gap:6px">
            <a class="btn ghost small" href="/api/p/filemanager/download?path=${encodeURIComponent(p)}" download>↓ Скачать</a>
            <button class="btn primary small" id="fm-save">💾 Сохранить</button>
          </div>
        </div>
        <textarea id="fm-editor" style="width:100%;min-height:60vh;font-family:var(--mono);font-size:12px;background:#000;color:#ededed;border:1px solid var(--border);border-radius:6px;padding:10px"></textarea>
        <div class="muted small" style="margin-top:4px">${fmtBytes(r.size)} · ${new Date(r.mtime).toLocaleString()}</div>`;
      pane.querySelector('#fm-editor').value = r.content;
      pane.querySelector('#fm-save').onclick = async () => {
        const content = pane.querySelector('#fm-editor').value;
        try { await WP.api.post('/save', { path: p, content }); WP.toast('💾 Сохранено'); }
        catch (e) { WP.toast('Ошибка: ' + e.message); }
      };
    } catch (e) {
      pane.innerHTML = `<div class="error">${WP.escapeHtml(e.message)}</div>`;
    }
  }

  view.querySelector('#fm-up').onclick = () => load(joinPath(cwd, '..'));
  view.querySelector('#fm-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') load(e.target.value || '/');
  });
  view.querySelector('#fm-mkdir').onclick = async () => {
    const name = prompt('Имя новой папки:');
    if (!name) return;
    try { await WP.api.post('/mkdir', { path: cwd.replace(/\/?$/, '/') + name }); load(cwd); }
    catch (e) { WP.toast('Ошибка: ' + e.message); }
  };
  view.querySelector('#fm-upload').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    try {
      await WP.api.post('/upload', { path: cwd, name: f.name, dataB64: b64 });
      WP.toast('↑ Загружено ' + f.name);
      load(cwd);
    } catch (err) { WP.toast('Ошибка: ' + err.message); }
    e.target.value = '';
  };

  load('/');
}
