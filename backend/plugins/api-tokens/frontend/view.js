export default async function init(WP) {
  const view = WP.view;

  async function reload() {
    const rows = await WP.api.get('/');
    view.querySelector('#tok-table tbody').innerHTML = rows.map(t => `
      <tr>
        <td><strong>${WP.escapeHtml(t.name)}</strong></td>
        <td class="muted">${WP.escapeHtml(t.username)}</td>
        <td><span class="badge ${t.scopes === 'write' ? 'on' : 'tag'}">${t.scopes}</span></td>
        <td class="muted small">${new Date(t.created_at).toLocaleString()}</td>
        <td class="muted small">${t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '—'}</td>
        <td><button class="btn ghost small" data-del="${t.id}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Токенов нет</td></tr>';
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Отозвать токен?')) return;
      await WP.api.del('/' + b.dataset.del);
      WP.toast('Отозван');
      reload();
    });
  }

  view.querySelector('#tok-add').onclick = () => view.querySelector('#tok-modal').hidden = false;
  view.querySelector('#tok-cancel').onclick = () => view.querySelector('#tok-modal').hidden = true;
  view.querySelector('#tok-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await WP.api.post('/', { name: fd.get('name'), scopes: fd.get('scopes') });
      view.querySelector('#tok-modal').hidden = true;
      e.target.reset();
      view.querySelector('#tok-value').textContent = r.token;
      view.querySelector('#tok-show').hidden = false;
      reload();
    } catch (err) { WP.toast('Ошибка: ' + err.message); }
  };
  view.querySelector('#tok-copy').onclick = () => {
    navigator.clipboard.writeText(view.querySelector('#tok-value').textContent);
    WP.toast('Скопировано');
  };
  view.querySelector('#tok-done').onclick = () => view.querySelector('#tok-show').hidden = true;

  reload();
}
