# ⚡ 𝚆𝙴𝙱𝙿𝙰𝙽𝙴𝙻 — 𝚂𝚎𝚛𝚟𝚎𝚛 𝙲𝚘𝚗𝚝𝚛𝚘𝚕 𝙿𝚊𝚗𝚎𝚕 🛰️

<a href="https://t.me/rv0x3l">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=F38020&height=200&section=header&text=WebPanel&fontSize=90&fontColor=ffffff&animation=fadeIn&fontAlignY=38" width="100%" />
</a>

<br/>

> **`System Status:`** *Modern, mobile-friendly server control panel in the style of Vercel & Cloudflare* 🚀

<p align="left">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-white?style=flat-square" /></a>
  <img src="https://img.shields.io/badge/node-20+-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/build-none-F38020?style=flat-square" />
  <img src="https://img.shields.io/badge/mobile-first-10b981?style=flat-square" />
  <img src="https://img.shields.io/github/stars/rv0x3l/webpanel?style=flat-square&color=F38020" />
</p>

---

### 🚧 Скриншоты

<p align="center">
  <img src="docs/img/banner.svg" alt="WebPanel" width="100%" />
</p>
<p align="center">
  <img src="docs/img/dashboard-mockup.svg" alt="Dashboard" width="90%" />
  <br/><i>Дашборд: real-time графики CPU/RAM/Disk/Net</i>
</p>
<p align="center">
  <img src="docs/img/terminal-mockup.svg" alt="Terminal" width="90%" />
  <br/><i>Терминал с экранной клавиатурой — <code>^O</code> сохраняет в nano с одного тапа</i>
</p>

---

### 🛠️ Стек

#### **Backend**
<code><img height="28" src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/WebSocket-010101?style=flat-square&logo=socket.io&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/ssh2-2E2E2E?style=flat-square&logo=openssh&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white" /></code>

#### **Frontend**
<code><img height="28" src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black" /></code>
<code><img height="28" src="https://img.shields.io/badge/xterm.js-000000?style=flat-square&logo=gnometerminal&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/noVNC-2E2E2E?style=flat-square&logo=vncviewer&logoColor=white" /></code>

#### **Платформа**
<code><img height="28" src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" /></code>
<code><img height="28" src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/systemd-30638E?style=flat-square&logo=systemd&logoColor=white" /></code>
<code><img height="28" src="https://img.shields.io/badge/Nginx-009639?style=flat-square&logo=nginx&logoColor=white" /></code>

---

### 🚀 Возможности

* 📊 **Live дашборд** — CPU, RAM, диски, сеть в реальном времени по WebSocket, sparkline-графики
* 🖥️ **Несколько серверов** — управление удалёнными хостами по SSH (пароль или ключ)
* ⌨️ **Веб-терминал** — xterm.js с **экранной клавиатурой** (Ctrl/Esc/Tab/стрелки/`^O`/`^X`) — работа с nano/vim на телефоне
* 🖼️ **VNC viewer** — встроенный noVNC, бэкенд проксирует WS↔TCP
* ⚙️ **systemd** — все юниты, фильтр, drawer со статусом и journalctl-логами, start/stop/enable/disable
* 🐳 **Docker** — контейнеры, stats, логи, inspect, образы, pull, prune
* 🧬 **Процессы** — топ, фильтр, kill в один тап
* 📱 **Mobile-first** — off-canvas сайдбар, touch-кнопки 38+px
* ⚡ **Hotkeys** — `Ctrl+K` палитра, `g+d/s/t/v/e/p/k` навигация, `?` помощь, `/` фильтр

---

### 📦 Quick Start

```bash
git clone https://github.com/rv0x3l/webpanel.git /opt/webpanel
cd /opt/webpanel
./scripts/install.sh
```

Открывай `http://<server>:8787` → логин `admin` / `admin` → смени пароль:

```bash
./scripts/reset-password.sh "your-strong-password"
systemctl restart webpanel
```

#### 🐳 Через Docker

```bash
git clone https://github.com/rv0x3l/webpanel.git && cd webpanel
JWT_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD=secret docker compose up -d
```

---

### 🧠 Архитектура

```mermaid
graph LR
    B["🌐 Browser SPA<br/>xterm.js · noVNC<br/>vanilla JS"] -->|HTTP + WebSocket| S
    S["⚙️ Node.js backend<br/>Express + ws"]
    S --> R["📊 REST /api/*"]
    S --> WS1["📡 WS /ws/stats"]
    S --> WS2["⌨️ WS /ws/terminal"]
    S --> WS3["🖼️ WS /ws/vnc"]
    R --> L1["systeminformation<br/>systemctl · docker"]
    WS2 --> L2["ssh2 / PTY"]
    WS3 --> L3["TCP ↔ VNC bridge"]
    S --> DB[("💾 SQLite<br/>better-sqlite3")]
```

---

### ⌨️ Горячие клавиши

| Действие | Клавиши |
|---|---|
| 🎯 Палитра команд | `Ctrl/Cmd + K` |
| ❓ Помощь | `?` |
| 🔄 Обновить раздел | `r` |
| 📱 Сайдбар | `m` |
| 🔍 Фильтр | `/` |
| ✖️ Закрыть | `Esc` |
| 🧭 Навигация | `g` затем `d/s/t/v/e/p/k` |

**В терминале:** `Ctrl Alt Shift Esc Tab ⌫ ↑↓←→ Home End PgUp PgDn ^C ^D ^L ^Z ^O ^X ^W ^K ^U F1…F12` + Copy/Paste/Clear/Reconnect

---

### 🗺️ Roadmap

* [ ] 🔐 2FA (TOTP)
* [ ] 👥 Multi-user с ролями
* [ ] 🔑 Шифрованное хранилище SSH-кредов
* [ ] 🌐 WireGuard / Tailscale
* [ ] 📈 Исторические графики
* [ ] 🔌 Plugin-система
* [ ] 📜 Файловый менеджер
* [ ] 🔔 Webhooks / Telegram алерты

---

### 📊 Статистика репозитория

<p align="left">
  <a href="https://github.com/rv0x3l/webpanel">
    <img src="https://github-readme-stats.vercel.app/api/pin/?username=rv0x3l&repo=webpanel&theme=radical&hide_border=true&title_color=F38020&icon_color=F38020" />
  </a>
</p>

<p align="left">
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=rv0x3l&repo=webpanel&layout=compact&theme=radical&hide_border=true&title_color=F38020" height="150" />
</p>

---

### 🤝 Контрибьютинг

PR'ы и идеи приветствуются 🙏 См. [CONTRIBUTING.md](CONTRIBUTING.md)

### 📜 Лицензия

[MIT](LICENSE) © [rv0x3l](https://github.com/rv0x3l)

### 🙏 Благодарности

[xterm.js](https://xtermjs.org/) · [noVNC](https://novnc.com/) · [systeminformation](https://systeminformation.io/) · [ssh2](https://github.com/mscdex/ssh2)

---

<p align="center">
  <a href="https://t.me/rv0x3l"><img src="https://img.shields.io/badge/Telegram-0088CC?style=flat-square&logo=telegram&logoColor=white" /></a>
  <img src="https://komarev.com/ghpvc/?username=rv0x3l&color=F38020&style=flat-square&label=Repo+views" />
</p>

<p align="center">
  ⭐ <b>Если зашло — поставь звезду</b> ⭐
</p>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=F38020&height=100&section=footer" width="100%" />
</p>
