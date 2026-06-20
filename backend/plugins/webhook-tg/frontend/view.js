export default async function init(WP) {
  const view = WP.view;
  const form = view.querySelector('#tg-form');
  const cfg = await WP.api.get('/config');

  form.elements.bot_token.placeholder = cfg.bot_token_set ? '•••••• (введён, можно оставить пустым)' : '123456:ABC-DEF…';
  form.elements.chat_id.value   = cfg.chat_id || '';
  form.elements.enabled.checked = !!cfg.enabled;
  form.elements.th_cpu.value    = cfg.thresholds?.cpu ?? 90;
  form.elements.th_mem.value    = cfg.thresholds?.mem ?? 90;
  form.elements.th_disk.value   = cfg.thresholds?.disk ?? 90;
  form.elements.a_cpu.checked   = cfg.alerts?.high_cpu  ?? true;
  form.elements.a_mem.checked   = cfg.alerts?.high_mem  ?? true;
  form.elements.a_disk.checked  = cfg.alerts?.high_disk ?? true;
  form.elements.a_auth.checked  = cfg.alerts?.auth_fail ?? true;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      enabled: form.elements.enabled.checked,
      chat_id: fd.get('chat_id'),
      thresholds: { cpu: +fd.get('th_cpu'), mem: +fd.get('th_mem'), disk: +fd.get('th_disk') },
      alerts: {
        high_cpu:  form.elements.a_cpu.checked,
        high_mem:  form.elements.a_mem.checked,
        high_disk: form.elements.a_disk.checked,
        auth_fail: form.elements.a_auth.checked,
      },
    };
    const bt = fd.get('bot_token');
    if (bt) body.bot_token = bt;
    await WP.api.post('/config', body);
    WP.toast('Сохранено');
  };

  view.querySelector('#tg-test').onclick = async () => {
    try {
      const fd = new FormData(form);
      const bt = fd.get('bot_token');
      const chat = fd.get('chat_id');
      // Save first if token entered, so test uses fresh values
      if (bt || chat) await WP.api.post('/config', { ...(bt ? { bot_token: bt } : {}), chat_id: chat });
      const r = await WP.api.post('/test', {});
      WP.toast(r.ok ? '✅ Сообщение отправлено' : 'Ошибка: ' + (r.error || ''));
    } catch (e) {
      WP.toast('Ошибка: ' + (e?.message || e));
    }
  };
}
