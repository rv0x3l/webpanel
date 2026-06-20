export default async function init(WP) {
  const view = WP.view;
  async function reload() {
    const r = await WP.api.get('/status');
    view.querySelector('#ufw-status').textContent = r.output || '';
    if (r.installed === false) {
      // Hide forms when UFW not installed
      view.querySelector('#ufw-add')?.setAttribute('hidden', '');
      view.querySelectorAll('.card-head .btn').forEach(b => b.setAttribute('disabled', ''));
      view.querySelector('#ufw-rule-actions').innerHTML = '';
      return;
    }
    view.querySelector('#ufw-add')?.removeAttribute('hidden');
    view.querySelectorAll('.card-head .btn').forEach(b => b.removeAttribute('disabled'));
    // Extract rule numbers from "[ 1] 22/tcp ..." lines
    const nums = [];
    for (const m of (r.output || '').matchAll(/^\[\s*(\d+)\]/gm)) nums.push(parseInt(m[1], 10));
    view.querySelector('#ufw-rule-actions').innerHTML = nums.map(n =>
      `<button class="btn ghost small" data-del="${n}">✕ ${n}</button>`).join('');
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Удалить правило #' + b.dataset.del + '?')) return;
      await WP.api.del('/rule/' + b.dataset.del);
      WP.toast('Удалено');
      reload();
    });
  }
  view.querySelector('#ufw-enable').onclick  = async () => { await WP.api.post('/enable', {}); WP.toast('UFW enabled'); reload(); };
  view.querySelector('#ufw-disable').onclick = async () => { if (confirm('Отключить firewall?')) { await WP.api.post('/disable', {}); WP.toast('UFW disabled'); reload(); } };
  view.querySelector('#ufw-reload').onclick  = async () => { await WP.api.post('/reload', {}); WP.toast('Reloaded'); reload(); };
  view.querySelector('#ufw-add').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try { await WP.api.post('/rule', fd); WP.toast('Правило добавлено'); e.target.reset(); reload(); }
    catch (err) { WP.toast('Ошибка: ' + err.message); }
  };
  reload();
}
