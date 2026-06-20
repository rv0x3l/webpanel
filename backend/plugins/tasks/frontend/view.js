export default async function init(WP) {
  const view = WP.view;

  async function reload() {
    const rows = await WP.api.get('/');
    view.querySelector('#task-table tbody').innerHTML = rows.map(t => `
      <tr>
        <td><strong>${WP.escapeHtml(t.name)}</strong></td>
        <td><code>${WP.escapeHtml(t.schedule)}</code></td>
        <td class="muted">${WP.escapeHtml(t.user)}</td>
        <td class="muted small"><code>${WP.escapeHtml(t.command)}</code></td>
        <td><button class="btn ghost small" data-del="${WP.escapeHtml(t.name)}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Задач нет</td></tr>';
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Удалить задачу ' + b.dataset.del + '?')) return;
      await WP.api.del('/' + encodeURIComponent(b.dataset.del));
      WP.toast('Удалена');
      reload();
    });
  }

  view.querySelector('#task-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try { await WP.api.post('/', body); WP.toast('Сохранена'); e.target.reset(); reload(); }
    catch (err) { WP.toast('Ошибка: ' + err.message); }
  };
  reload();
}
