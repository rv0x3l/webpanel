# 🔑 WebPanel API

Полная справка по HTTP / WebSocket API. Подходит для интеграции с CI, мониторингом, ботами, скриптами.

- **Base URL:** `http://your-panel:8787`
- **Авторизация:** JWT cookie *(браузер)* или `X-API-Token` *(скрипты)*
- **Формат:** JSON везде. Все мутирующие эндпоинты ожидают `Content-Type: application/json`.

> 💡 Префикс `/api` обязателен для REST. WebSocket — на `/ws`. Плагины: REST `/api/p/<plugin>/...`, статика `/p/<plugin>/...`, WS `/ws/p/<plugin>/...`.

## 📚 Содержание

- [Авторизация](#-авторизация)
- [Роли и права](#-роли-и-права)
- [API-токены](#-api-токены)
- [Эндпоинты](#-эндпоинты)
  - [Auth](#auth)
  - [Профиль и 2FA](#профиль-и-2fa)
  - [Пользователи (admin)](#пользователи-admin)
  - [Audit log (admin)](#audit-log-admin)
  - [Plugins](#plugins)
  - [System](#system)
  - [Servers](#servers)
  - [Systemd](#systemd)
  - [Docker](#docker)
  - [Plugin API](#plugin-api-встроенные)
- [WebSocket](#-websocket)
- [Коды ошибок](#-коды-ошибок)
- [Примеры интеграций](#-примеры-интеграций)

---

## 🔐 Авторизация

### Вариант A: cookie + JWT (для браузера)

```bash
# 1. логин
curl -c jar.txt -X POST http://panel:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}'

# 2. использовать cookie во всех запросах
curl -b jar.txt http://panel:8787/api/system/live
```

Если у пользователя включён 2FA — ответ будет `{"step":"totp","tmpToken":"…"}`. Второй шаг:

```bash
curl -c jar.txt -X POST http://panel:8787/api/auth/totp \
  -H 'Content-Type: application/json' \
  -d '{"tmpToken":"…","code":"123456"}'
```

### Вариант B: API-токен (для скриптов / CI)

```bash
curl -H "X-API-Token: wp_5b242f2…" http://panel:8787/api/system/live
```

Создать токен: **Админ → API токены → + Новый токен**, или через REST (см. ниже). Токен показывается **один раз**, сохрани сразу.

> Альтернатива: `Authorization: Bearer <jwt>` тоже работает.

---

## 🎭 Роли и права

| Роль | Что может |
|---|---|
| `viewer` | Только чтение: дашборд, списки сервисов/Docker/серверов. WS `/ws/stats`. Никаких действий. |
| `operator` | + reboot/poweroff, start/stop сервисов, управление Docker, CRUD серверов, **терминал** (`/ws/terminal`), **VNC** (`/ws/vnc`). |
| `admin` | + Управление пользователями, audit, plugins, daemon-reload, docker prune. Все плагины с `minRole: admin`. |

Если запрос требует роль выше — `403 {"error":"role required: <role>"}`.

API-токены имеют scope **`read`** (только `GET`) или **`write`** (любые методы). Токен с `read` на POST/PUT/DELETE даст `403`.

---

## 🔑 API-токены

Управление через плагин **api-tokens** (`admin`). Эндпоинты в [Plugin API](#plugin-api-встроенные).

Формат токена: `wp_` + 32 hex-символа. Hash (sha256) сохраняется в БД, оригинал доступен только при создании.

При каждом запросе обновляется `last_used_at` — видно в UI.

---

## 📡 Эндпоинты

### Auth

| Метод | URL | Роль | Описание |
|---|---|---|---|
| POST | `/api/auth/login` | — | Логин: `{username, password}`. Ответ `{token, user}` либо `{step:"totp", tmpToken}`. Ставит cookie. |
| POST | `/api/auth/totp` | — | Второй шаг 2FA: `{tmpToken, code}`. Ставит cookie, возвращает `{token, user}`. |
| POST | `/api/auth/logout` | auth | Удаляет cookie. |
| GET | `/api/auth/me` | auth | Текущий пользователь: `{user:{id, username, role, totp_enabled}}`. |

**Rate limit:** 20 попыток / минуту / IP на `/api/auth/login` и `/api/auth/totp`.

### Профиль и 2FA

| Метод | URL | Роль | Описание |
|---|---|---|---|
| POST | `/api/users/me/totp/enroll` | auth | Сгенерировать секрет. Ответ `{secret, uri}` — отсканируй URI как QR. |
| POST | `/api/users/me/totp/confirm` | auth | Подтвердить 6-значным кодом: `{code}`. Включает 2FA. |
| POST | `/api/users/me/totp/disable` | auth | Отключить: `{code}`. |

### Пользователи (admin)

| Метод | URL | Тело | Описание |
|---|---|---|---|
| GET | `/api/users` | — | Список пользователей. |
| POST | `/api/users` | `{username, password, role}` | Создать. Роль: `viewer`/`operator`/`admin`. |
| PUT | `/api/users/:id` | `{password?, role?}` | Обновить пароль или роль. |
| DELETE | `/api/users/:id` | — | Удалить. Нельзя удалить последнего админа. |

### Audit log (admin)

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/audit?limit=200` | Последние записи (max 1000). |

### Plugins

| Метод | URL | Роль | Описание |
|---|---|---|---|
| GET | `/api/plugins` | auth | Список **включённых** доступных мне плагинов. |
| GET | `/api/plugins/admin` | admin | Список **всех** плагинов с `enabled` флагом. |
| POST | `/api/plugins/:name/toggle` | admin | Тело `{enabled: true\|false}`. |

### System

| Метод | URL | Роль | Параметры | Описание |
|---|---|---|---|---|
| GET | `/api/system/static` | auth | `?serverId=N` | Hostname, OS, CPU, system, memTotal. |
| GET | `/api/system/live` | auth | `?serverId=N` | Снимок CPU/RAM/Disks/Net/Top processes. |
| GET | `/api/system/services` | auth | — | Топ-50 systemd-сервисов через `systeminformation`. |
| GET | `/api/system/docker` | auth | — | Общая инфа о Docker и контейнерах. |
| POST | `/api/system/action` | operator | См. ниже | Системные действия. |

**`/api/system/action`** принимает `{action, args}`:

```json
{ "action": "reboot" }
{ "action": "poweroff" }
{ "action": "cancel-shutdown" }
{ "action": "kill", "args": { "pid": 1234, "signal": "TERM" } }
{ "action": "service", "args": { "name": "nginx.service", "op": "restart" } }
{ "action": "exec", "args": { "cmd": "uptime" } }
```

Ответ: `{ ok, stdout, stderr, code? }`.

### Servers

| Метод | URL | Роль | Описание |
|---|---|---|---|
| GET | `/api/servers` | auth | Список. |
| POST | `/api/servers` | operator | Создать: `{name, host, port=22, username, auth_type, password?, private_key?, vnc_host?, vnc_port?, vnc_password?, tags?}`. `auth_type` — `password` или `key`. |
| PUT | `/api/servers/:id` | operator | Обновить любые поля. Локальный сервер редактировать нельзя. |
| DELETE | `/api/servers/:id` | operator | Удалить. Локальный — нет. |
| POST | `/api/servers/:id/test` | auth | Проверить SSH-подключение. |
| GET | `/api/servers/:id/stats` | auth | Снапшот удалённого сервера (raw). |

### Systemd

| Метод | URL | Роль | Описание |
|---|---|---|---|
| GET | `/api/sd/units?type=service&state=all` | auth | Список юнитов. `type`: service/socket/timer/mount/target/path. `state`: all/running/failed/loaded/active/inactive. |
| GET | `/api/sd/units/:name/status` | auth | `systemctl status` без логов. |
| GET | `/api/sd/units/:name/show` | auth | Все properties `systemctl show`. |
| GET | `/api/sd/units/:name/logs?lines=100` | auth | `journalctl -u <name> -n <lines>`. |
| POST | `/api/sd/units/:name/action` | operator | `{op}`: `start`, `stop`, `restart`, `reload`, `enable`, `disable`, `mask`, `unmask`, `reload-or-restart`. |
| POST | `/api/sd/daemon-reload` | admin | `systemctl daemon-reload`. |

### Docker

| Метод | URL | Роль | Описание |
|---|---|---|---|
| GET | `/api/dk/info` | auth | `{available, version}`. |
| GET | `/api/dk/containers?all=1` | auth | Список. `all=0` — только running. |
| GET | `/api/dk/images` | auth | Список образов. |
| POST | `/api/dk/containers/:id/action` | operator | `{op}`: `start`, `stop`, `restart`, `pause`, `unpause`, `kill`, `rm`. |
| GET | `/api/dk/containers/:id/logs?lines=200` | auth | Логи (с таймстампами). |
| GET | `/api/dk/containers/:id/inspect` | auth | `docker inspect` JSON. |
| GET | `/api/dk/containers/:id/stats` | auth | Снимок CPU/MEM/Net/Block IO. |
| DELETE | `/api/dk/images/:id` | operator | Удалить образ. |
| POST | `/api/dk/images/pull` | operator | `{image}`. Таймаут 120с. |
| POST | `/api/dk/prune` | admin | `{target}`: `containers`, `images`, `volumes`, `system`. |

### Plugin API (встроенные)

Все плагины монтируются под `/api/p/<plugin>/`. Авторизация наследуется + проверка `minRole` плагина (у всех built-in — `admin`).

#### `webhook-tg`

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/p/webhook-tg/config` | Получить настройки (без bot_token). |
| POST | `/api/p/webhook-tg/config` | Обновить: `{enabled, chat_id, bot_token, thresholds:{cpu,mem,disk}, alerts:{high_cpu, high_mem, high_disk, auth_fail}}`. |
| POST | `/api/p/webhook-tg/test` | Отправить тестовое сообщение. |
| POST | `/api/p/webhook-tg/send` | Произвольное сообщение: `{text}`. |

#### `filemanager`

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/p/filemanager/list?path=/etc` | Содержимое директории: `{path, root, items:[{name,type,size,mtime,mode}]}`. |
| GET | `/api/p/filemanager/read?path=…` | Чтение. Текст → `{content}`, бинарь → `{binary:true}`. Максимум 5 MB для текста. |
| POST | `/api/p/filemanager/save` | `{path, content}`. |
| POST | `/api/p/filemanager/mkdir` | `{path}`. |
| POST | `/api/p/filemanager/rename` | `{from, to}`. |
| DELETE | `/api/p/filemanager/delete?path=…` | Файл или директория (рекурсивно). |
| GET | `/api/p/filemanager/download?path=…` | Скачать как файл. |
| POST | `/api/p/filemanager/upload` | `{path, name, dataB64}`. |
| GET | `/api/p/filemanager/root` | Текущий root. |
| POST | `/api/p/filemanager/root` | `{root}`. |

#### `api-tokens`

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/p/api-tokens/` | Список всех токенов (без значений). |
| POST | `/api/p/api-tokens/` | `{name, scopes:"read"\|"write", userId?}`. Возвращает `{id, token, note}` — токен **один раз!** |
| DELETE | `/api/p/api-tokens/:id` | Отозвать. |

#### `ufw`

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/p/ufw/status` | `ufw status numbered verbose`. |
| POST | `/api/p/ufw/enable` / `/disable` / `/reload` | — |
| POST | `/api/p/ufw/rule` | `{action:"allow"\|"deny"\|"reject"\|"limit", port, proto:"tcp"\|"udp"\|"any", from?, comment?}`. |
| DELETE | `/api/p/ufw/rule/:num` | Удалить правило по номеру. |

#### `tasks` (cron)

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/p/tasks/` | Список задач из `/etc/cron.d/webpanel-*`. |
| POST | `/api/p/tasks/` | `{name, schedule, user, command}`. Schedule — cron или `@reboot/@hourly/@daily/@weekly/@monthly`. |
| DELETE | `/api/p/tasks/:name` | Удалить. |

---

## 🔌 WebSocket

Авторизация: cookie (если same-origin) или `?token=<jwt>` в query.

| URL | Роль | Сообщения |
|---|---|---|
| `/ws/stats?serverId=N` | viewer | Сервер → `{"type":"stats","data":{...}}` каждые 2с. |
| `/ws/terminal?serverId=N&cols=80&rows=24` | operator | Двусторонний поток терминала. Клиент → байты ввода. Сервер → байты вывода. Resize: `{"resize":{"cols":120,"rows":40}}`. |
| `/ws/vnc?serverId=N` | operator | Чистый TCP-прокси к VNC-серверу. |
| `/ws/p/<plugin>/<path>` | По манифесту плагина | Реализуется в плагине через `ctx.registerWs`. |

### Пример: real-time stats

```js
const ws = new WebSocket('wss://panel.example.com/ws/stats');
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'stats') console.log('CPU:', m.data.cpu.load);
};
```

---

## ❌ Коды ошибок

| Код | Когда |
|---|---|
| `400` | Невалидное тело / параметры. |
| `401` | Не авторизован / неверный токен. |
| `403` | Нет нужной роли или scope (`read`-токен на не-GET). |
| `404` | Объект не найден. |
| `429` | Rate limit (login/totp). |
| `500` | Внутренняя ошибка. |
| `502` | Ошибка восходящего сервиса (SSH, TG API). |
| `503` | Плагин отключён. |

Формат ответа на ошибку: `{"error":"описание"}`.

---

## 💡 Примеры интеграций

### Bash: уведомить себя в TG если CPU > 80%

```bash
#!/usr/bin/env bash
TOKEN=wp_5b242f2…
CPU=$(curl -s -H "X-API-Token: $TOKEN" http://panel:8787/api/system/live \
        | jq -r '.cpu.load')
if (( $(echo "$CPU > 80" | bc -l) )); then
  curl -s -H "X-API-Token: $TOKEN" -X POST \
    http://panel:8787/api/p/webhook-tg/send \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"🔥 CPU: ${CPU}%\"}"
fi
```

### Python: ежедневный health-чек

```python
import os, requests

PANEL = "https://panel.example.com"
TOKEN = os.environ["WEBPANEL_TOKEN"]
H = {"X-API-Token": TOKEN}

live = requests.get(f"{PANEL}/api/system/live", headers=H).json()
mem_pct = live["mem"]["used"] / live["mem"]["total"] * 100
root_disk = next(d for d in live["disks"] if d["mount"] == "/")

print(f"CPU {live['cpu']['load']:.1f}%  RAM {mem_pct:.1f}%  Disk / {root_disk['use']:.1f}%")
```

### Node.js: рестарт сервиса при падении

```js
const PANEL = 'http://panel:8787';
const H = { 'X-API-Token': process.env.WP_TOKEN, 'Content-Type': 'application/json' };

const status = await fetch(`${PANEL}/api/sd/units/myapp.service/status`, { headers: H }).then(r => r.json());
if (!status.output.includes('active (running)')) {
  await fetch(`${PANEL}/api/sd/units/myapp.service/action`, {
    method: 'POST', headers: H, body: JSON.stringify({ op: 'restart' }),
  });
  console.log('Restarted myapp');
}
```

### GitHub Actions: deploy hook

```yaml
- name: Pull and restart on prod
  run: |
    curl -fSs -H "X-API-Token: ${{ secrets.WEBPANEL_TOKEN }}" \
      -X POST https://panel.example.com/api/system/action \
      -H 'Content-Type: application/json' \
      -d '{"action":"exec","args":{"cmd":"cd /opt/myapp && git pull && systemctl restart myapp"}}'
```

> Для exec в production лучше выдавать токены отдельным сервисным пользователям и логировать через audit.

---

## 🔗 См. также

- [README](../README.md) — общее описание панели
- [PLUGINS.md](PLUGINS.md) — как написать свой плагин
- [CONTRIBUTING.md](../CONTRIBUTING.md) — как контрибьютить
