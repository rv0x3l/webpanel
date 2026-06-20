# Contributing to WebPanel

Thanks for your interest! This guide explains how to set up the project for development and contribute changes.

## Development setup

```bash
git clone https://github.com/<you>/webpanel.git
cd webpanel/backend
cp .env.example .env
npm install
npm run dev   # node --watch server.js
```

Open `http://localhost:8787` and log in with `admin` / `admin` (change in `.env`).

The frontend is plain HTML/CSS/JS, served from `frontend/` directly by the backend. There's no build step — edit files and reload.

## Code style

- Backend: ES modules (`"type": "module"`), Node 20+, no TypeScript.
- Frontend: vanilla JS, no bundler. Keep helpers small and focused.
- Indent 2 spaces, single quotes, semicolons.

## Reporting bugs

Open an issue with:
- What you did, expected, actual
- OS and Node version
- Relevant `journalctl -u webpanel` lines

## Submitting changes

1. Fork & create a feature branch (`feat/foo`, `fix/bar`)
2. Make the change. Keep PRs focused — one feature/fix per PR.
3. Test the dev server, including on mobile/tablet viewport (DevTools device emulation).
4. Open a PR describing **what** and **why**.

## Areas that need help

- More languages (currently RU/EN)
- Theming / additional color schemes
- Multi-user / RBAC
- 2FA login
- More remote-host plugins (Proxmox, Hetzner Cloud API, ...)
- Tests

## Security

If you find a security issue, please **don't** open a public issue. Email the maintainer or open a private GitHub security advisory.
