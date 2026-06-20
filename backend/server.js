import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';

import { initDb, ensureAdmin, ensureLocalServer, getDb } from './src/db.js';
import { verifyToken, authMiddleware } from './src/auth.js';
import { getLive } from './src/stats.js';
import { createSshShell } from './src/sshClient.js';
import { bridgeWsToVnc } from './src/vncProxy.js';
import { RemoteStats } from './src/remoteStats.js';
import { loadPlugins, pluginsAccessibleTo } from './src/pluginLoader.js';
import routes from './src/routes.js';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'panel.db');

initDb(DB_PATH);
ensureAdmin(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD || 'admin');
ensureLocalServer();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.use('/api/auth/login', rateLimit({ windowMs: 60_000, max: 20 }));
app.use('/api/auth/totp', rateLimit({ windowMs: 60_000, max: 20 }));
app.use('/api', routes);

const wsHandlers = new Map(); // path → handler(ws, req, url)

// Load plugins
const PLUGINS_DIR = path.resolve(__dirname, 'plugins');
const plugins = await loadPlugins({ app, wsHandlers, pluginsDir: PLUGINS_DIR });

app.get('/api/plugins', authMiddleware, (req, res) => {
  res.json(pluginsAccessibleTo(plugins, req.user.role));
});

// Static frontend
const FRONT_DIR = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(FRONT_DIR));
app.get(/^(?!\/(api|p)(\/|$)).*/, (req, res) => {
  res.sendFile(path.join(FRONT_DIR, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function authFromReq(req) {
  // Token via cookie or ?token=
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=')).filter(p => p.length === 2)
  );
  const tokenFromCookie = cookies.token;
  const url = new URL(req.url, 'http://x');
  const tokenFromQuery = url.searchParams.get('token');
  return verifyToken(tokenFromCookie || tokenFromQuery || '');
}

server.on('upgrade', (req, socket, head) => {
  const user = authFromReq(req);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.user = user;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const route = url.pathname;

  try {
    if (route === '/ws/stats') {
      // Live system stats stream (local or remote via SSH)
      const serverId = parseInt(url.searchParams.get('serverId') || '0', 10);
      let getter;
      let remote = null;

      if (serverId) {
        const db = getDb();
        const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
        if (srv && !srv.is_local) {
          remote = new RemoteStats(srv);
          try { await remote.ensure(); }
          catch (e) {
            try { ws.send(JSON.stringify({ type: 'error', message: 'SSH: ' + e.message })); } catch {}
            ws.close();
            return;
          }
          getter = () => remote.getLive();
        }
      }
      if (!getter) getter = getLive;

      const send = async () => {
        try {
          ws.send(JSON.stringify({ type: 'stats', data: await getter() }));
        } catch (e) {
          try { ws.send(JSON.stringify({ type: 'error', message: e.message })); } catch {}
        }
      };
      await send();
      const iv = setInterval(send, 2000);
      ws.on('close', () => {
        clearInterval(iv);
        if (remote) remote.close();
      });
      return;
    }

    if (route === '/ws/terminal') {
      const serverId = parseInt(url.searchParams.get('serverId') || '0', 10);
      const cols = parseInt(url.searchParams.get('cols') || '80', 10);
      const rows = parseInt(url.searchParams.get('rows') || '24', 10);

      const db = getDb();
      const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
      if (!srv) { ws.close(1008, 'server not found'); return; }

      if (srv.is_local) {
        // local bash
        const proc = spawn('/bin/bash', ['-il'], {
          env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) },
        });
        proc.stdout.on('data', d => ws.readyState === ws.OPEN && ws.send(d));
        proc.stderr.on('data', d => ws.readyState === ws.OPEN && ws.send(d));
        proc.on('close', () => ws.close());
        ws.on('message', msg => {
          try {
            const txt = msg.toString();
            if (txt.startsWith('{') && txt.includes('"resize"')) {
              const obj = JSON.parse(txt);
              if (obj.resize) return; // no PTY without node-pty; ignore resize
            }
          } catch {}
          proc.stdin.write(msg);
        });
        ws.on('close', () => proc.kill());
        return;
      }

      // remote via SSH
      try {
        const { conn, stream } = await createSshShell(srv, { cols, rows });
        stream.on('data', d => ws.readyState === ws.OPEN && ws.send(d));
        stream.stderr?.on('data', d => ws.readyState === ws.OPEN && ws.send(d));
        stream.on('close', () => { try { conn.end(); } catch {} ws.close(); });
        ws.on('message', msg => {
          try {
            const txt = msg.toString();
            if (txt.startsWith('{') && txt.includes('"resize"')) {
              const obj = JSON.parse(txt);
              if (obj.resize) {
                stream.setWindow(obj.resize.rows, obj.resize.cols);
                return;
              }
            }
          } catch {}
          stream.write(msg);
        });
        ws.on('close', () => { try { conn.end(); } catch {} });
      } catch (e) {
        ws.send(`\r\nSSH error: ${e.message}\r\n`);
        ws.close();
      }
      return;
    }

    // Plugin WS handlers
    if (route.startsWith('/ws/p/')) {
      const h = wsHandlers.get(route);
      if (h) { await h(ws, req, url); return; }
      ws.close(1008, 'plugin ws not found');
      return;
    }

    if (route === '/ws/vnc') {
      const serverId = parseInt(url.searchParams.get('serverId') || '0', 10);
      const db = getDb();
      const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
      if (!srv) { ws.close(1008, 'server not found'); return; }
      const host = srv.vnc_host || srv.host;
      const port = srv.vnc_port || 5900;
      if (!host || !port) { ws.close(1008, 'vnc not configured'); return; }
      bridgeWsToVnc(ws, { host, port });
      return;
    }

    ws.close(1008, 'unknown route');
  } catch (e) {
    console.error('[ws]', e);
    try { ws.close(1011, 'internal error'); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[webpanel] listening on http://${HOST}:${PORT}`);
});
