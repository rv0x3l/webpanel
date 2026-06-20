# 🔌 Создание плагинов для WebPanel

Плагин — это самостоятельный модуль, который добавляет в панель новые **API-эндпоинты**, **WebSocket-каналы** и **страницу в сайдбаре**. Никаких пересборок; достаточно положить папку в `backend/plugins/`, перезапустить сервис — плагин появится в навигации.

## 📁 Структура

```
backend/plugins/<name>/
├── plugin.json        ← манифест (обязательно)
├── backend.js         ← серверная логика (необязательно)
└── frontend/
    ├── view.html      ← HTML-фрагмент страницы
    └── view.js        ← ESM, экспортирует default function init(WP)
```

Минимально работающий плагин — это просто `plugin.json` + `frontend/view.html`.

## 📜 Манифест `plugin.json`

```json
{
  "name": "myplugin",
  "label": "Мой плагин",
  "icon": "🚀",
  "version": "1.0.0",
  "description": "Что плагин делает.",
  "minRole": "operator"
}
```

Поля:

| Поле | Обязат. | Описание |
|---|---|---|
| `name` | ✅ | Уникальный идентификатор, латиница/дефисы. Используется в URL: `/api/p/<name>`, `/p/<name>` |
| `label` | — | Отображаемое имя в сайдбаре. Если не задано — берётся `name`. |
| `icon` | — | Один эмодзи или символ для иконки в сайдбаре. |
| `version` | — | SemVer-строка. |
| `description` | — | Краткое описание (показывается в `/api/plugins`). |
| `minRole` | — | Минимальная роль для доступа: `viewer`, `operator`, `admin`. По умолчанию `operator`. |

## 🧠 `backend.js` — серверный код

Экспортирует **default function**, которой панель передаёт `ctx` — контекст плагина.

```js
export default async function init(ctx) {
  // Define HTTP endpoints. Mounted at /api/p/<name>/...
  ctx.router.get('/hello', (req, res) => {
    res.json({ msg: 'Hello from ' + ctx.name });
  });

  // Persist config / state in plugin_settings table
  const cfg = ctx.settings.get('counter', 0);
  ctx.settings.set('counter', cfg + 1);

  // Audit user actions
  ctx.router.post('/dangerous', (req, res) => {
    // ... do something
    ctx.auditAs(req.user.id, 'dangerous.executed', { what: req.body });
    res.json({ ok: true });
  });

  // Subscribe to system events (audit, etc)
  ctx.events.on('audit', ev => {
    if (ev.action === 'auth.fail') console.log('[myplugin] saw failed login', ev);
  });

  // WebSocket endpoint — at /ws/p/<name>/<subpath>
  ctx.registerWs('/stream', async (ws, req, url) => {
    ws.send('hello');
    const iv = setInterval(() => ws.send(`tick ${Date.now()}`), 1000);
    ws.on('close', () => clearInterval(iv));
  });
}
```

### Контекст `ctx`

| Свойство | Тип | Описание |
|---|---|---|
| `ctx.name` | `string` | Имя плагина (из манифеста) |
| `ctx.dir` | `string` | Полный путь к директории плагина (для чтения файлов плагина) |
| `ctx.router` | Express Router | Сюда вешай эндпоинты. Authority уже наложена + проверка `minRole`. |
| `ctx.app` | Express App | Главный app (использовать редко) |
| `ctx.db` | `better-sqlite3` | Прямой доступ к SQLite, если нужны свои таблицы. |
| `ctx.settings` | `{ get(key, default), set(key, value), all() }` | Persistent KV-хранилище в таблице `plugin_settings`. JSON сериализуется автоматически. |
| `ctx.audit(action, details)` | function | Системная запись в `audit_log` (без user_id). |
| `ctx.auditAs(userId, action, details)` | function | Запись от имени пользователя. |
| `ctx.events` | EventEmitter | Глобальная шина: подписывайся на `audit`, эмить свои. |
| `ctx.runCommand(cmd, timeout?)` | async | Выполнить shell-команду локально, вернуть `{ok, stdout, stderr}`. |
| `ctx.execOnServer(serverCfg, cmd)` | async | Выполнить на удалённом сервере по SSH. |
| `ctx.registerWs(subpath, handler)` | function | Зарегистрировать WS-обработчик на `/ws/p/<name><subpath>`. |
| `ctx.getLive()` | async | Получить локальную статистику системы (используется в webhook-tg для мониторинга порогов). |
| `ctx.getStatic()` | async | Статическая информация о сервере. |

### Доступ в `req.user`

Внутри обработчиков всегда есть `req.user`:

```js
req.user = { id, username, role, viaToken?, scopes? }
```

`role` — одно из `viewer | operator | admin`. Если запрос пришёл по API-токену, будет `viaToken: true` и `scopes: 'read'|'write'`.

## 🎨 `frontend/view.html`

Просто HTML-фрагмент, который будет вставлен внутрь `#view`. Не нужен `<html>` / `<body>`. Используй существующие CSS-классы (`.card`, `.btn`, `.input`, `.table-wrap`, `.modal`, `.kv-list` и т.д.).

```html
<section class="card">
  <h3>🚀 Мой плагин</h3>
  <button class="btn primary" id="hello">Поздороваться</button>
  <pre id="out" class="muted small"></pre>
</section>
```

## ⚡ `frontend/view.js`

ESM-модуль с default-функцией. Получает SDK-объект **`WP`**:

```js
export default async function init(WP) {
  const view = WP.view; // DOM-элемент, в который вставился view.html

  view.querySelector('#hello').onclick = async () => {
    const r = await WP.api.get('/hello');
    view.querySelector('#out').textContent = JSON.stringify(r, null, 2);
    WP.toast('Привет 👋');
  };
}
```

### SDK `WP`

| Поле | Описание |
|---|---|
| `WP.plugin` | Имя плагина |
| `WP.view` | Корневой элемент (то самое `#view`) |
| `WP.api.get(path)` | `GET /api/p/<name><path>` |
| `WP.api.post(path, body)` | `POST` с JSON-телом |
| `WP.api.put(path, body)` | `PUT` |
| `WP.api.del(path)` | `DELETE` |
| `WP.toast(msg)` | Показать всплывающее уведомление |
| `WP.escapeHtml(s)` | Безопасно вставить текст в `innerHTML` |
| `WP.openDrawer(title, htmlBody)` / `WP.closeDrawer()` | Боковой drawer справа |
| `WP.navigate(hash)` | Программная навигация |
| `WP.state` | Глобальное состояние приложения (read-only по факту) |

### WebSocket из фронта

```js
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${proto}://${location.host}/ws/p/${WP.plugin}/stream`);
ws.onmessage = e => console.log(e.data);
```

## 🔒 Безопасность

- Эндпоинты автоматически защищены: требуют `authMiddleware` и проверяют `minRole`. Можешь не накладывать дополнительных проверок.
- Любые операции с пользовательским вводом (особенно shell-команды, пути в FS) **валидируй сам**. Пример санитайза имени systemd-юнита смотри в `backend/src/systemd.js`, путей — в `plugins/filemanager/backend.js`.
- Аудитируй чувствительные действия через `ctx.auditAs(req.user.id, 'action', details)`.

## 🔑 Доступ через API-токены

Если плагин предоставляет API для внешних систем, токены работают автоматически:

```http
GET /api/p/myplugin/hello HTTP/1.1
Host: panel.example.com
X-API-Token: wp_5b242f...
```

Токены с scope `read` могут только GET, `write` — все методы.

## 📦 Встроенные плагины

| Плагин | Что делает |
|---|---|
| **webhook-tg** | Алерты в Telegram при превышении CPU/RAM/диска, неудачных логинах. |
| **filemanager** | Браузер файлов с правкой/закачкой/скачкой. |
| **api-tokens** | Менеджмент API-токенов. |
| **ufw** | Управление firewall UFW. |
| **tasks** | Планировщик задач через `/etc/cron.d/webpanel-*`. |

Изучи их код в `backend/plugins/` как примеры.

## 💡 Идеи для своих плагинов

- 🔄 **Backups** — `tar.gz`/`rsync`-бэкапы по расписанию в локальную папку или S3
- 🌐 **DNS** — Cloudflare DNS-записи через API
- 🔐 **Certificates** — Let's Encrypt через `acme.sh` / `certbot`
- 🐝 **WireGuard / Tailscale** — генерация конфигов, список клиентов
- 📦 **Updates** — `apt list --upgradable`, запуск `apt upgrade` со стримом логов
- 🌍 **Nginx sites** — добавить/удалить vhost из `/etc/nginx/sites-available`
- 📊 **Logs viewer** — tail произвольного лог-файла через WS
- 🗄 **MySQL / PostgreSQL** — менеджер БД, запросы, бэкапы
- 🔔 **Notifications** — несколько каналов (Discord, Slack, email, ntfy.sh)
- 🛒 **Docker compose** — управление `docker-compose.yml`
- 🌐 **Network** — список интерфейсов, статус, ping/traceroute
- 🔒 **Fail2ban** — статус, бан/разбан IP
- 📺 **Monitoring** — собственные графики (Chart.js) для своих метрик
- 🤖 **Cron monitor** — кто запускал и когда, последние логи
- 📁 **Snapshots** — ZFS / btrfs снимки

## 🧪 Дебаг

- Логи плагина видны в `journalctl -u webpanel -f` (это stdout/stderr Node-процесса).
- `console.log()` в `backend.js` пишется в journalctl, в `view.js` — в браузерную консоль.
- При ошибке в backend плагина — он не загрузится, остальные продолжат работать.
- Чтобы перезагрузить плагин: `systemctl restart webpanel` (горячая перезагрузка пока не поддерживается).

## 🤝 Поделись своим плагином

Если получилось что-то крутое — открывай Pull Request в репозиторий, выкладывай в отдельный GitHub-репо или добавляй в список выше. Договоримся об индексе сторонних плагинов в `awesome-webpanel-plugins`.
