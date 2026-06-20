import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { authMiddleware, requireRole } from './auth.js';
import { audit, events } from './audit.js';
import { getDb } from './db.js';
import { runCommand } from './exec.js';
import { execOnServer } from './sshClient.js';
import { getLive, getStatic } from './stats.js';

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

function makeSettingsApi(pluginName) {
  return {
    get(key, defaultValue = null) {
      const row = getDb().prepare('SELECT value FROM plugin_settings WHERE plugin = ? AND key = ?').get(pluginName, key);
      if (!row) return defaultValue;
      try { return JSON.parse(row.value); } catch { return row.value; }
    },
    set(key, value) {
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      getDb().prepare(`
        INSERT INTO plugin_settings (plugin, key, value) VALUES (?, ?, ?)
        ON CONFLICT(plugin, key) DO UPDATE SET value = excluded.value
      `).run(pluginName, key, v);
    },
    all() {
      const rows = getDb().prepare('SELECT key, value FROM plugin_settings WHERE plugin = ?').all(pluginName);
      const out = {};
      for (const r of rows) {
        try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
      }
      return out;
    },
  };
}

export async function loadPlugins({ app, wsHandlers, pluginsDir }) {
  const loaded = [];
  if (!fs.existsSync(pluginsDir)) return loaded;

  for (const name of fs.readdirSync(pluginsDir).sort()) {
    const full = path.join(pluginsDir, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const manifestPath = path.join(full, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); }
    catch (e) { console.error(`[plugin:${name}] bad manifest:`, e.message); continue; }

    const minRole = manifest.minRole || 'operator';

    const router = express.Router();
    router.use(authMiddleware);
    router.use(requireRole(minRole));

    const ctx = {
      name: manifest.name,
      dir: full,
      router,
      app,
      db: getDb(),
      audit: (action, details) => audit(null, `plugin.${manifest.name}.${action}`, details),
      auditAs: (userId, action, details) => audit(userId, `plugin.${manifest.name}.${action}`, details),
      events,
      runCommand,
      execOnServer,
      settings: makeSettingsApi(manifest.name),
      getLive,
      getStatic,
      registerWs(subpath, handler) {
        wsHandlers.set(`/ws/p/${manifest.name}${subpath}`, handler);
      },
    };

    const backendPath = path.join(full, 'backend.js');
    if (fs.existsSync(backendPath)) {
      try {
        const mod = await import('file://' + path.resolve(backendPath));
        if (typeof mod.default === 'function') await mod.default(ctx);
      } catch (e) {
        console.error(`[plugin:${name}] backend error:`, e);
        continue;
      }
    }

    app.use(`/api/p/${manifest.name}`, router);

    const frontDir = path.join(full, 'frontend');
    if (fs.existsSync(frontDir)) {
      app.use(`/p/${manifest.name}`, express.static(frontDir));
    }

    loaded.push({
      name: manifest.name,
      label: manifest.label || manifest.name,
      icon: manifest.icon || '◆',
      minRole,
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      route: manifest.route !== false,
    });
    console.log(`[plugin] loaded: ${manifest.name} v${manifest.version || '?'} (minRole=${minRole})`);
  }
  return loaded;
}

export function pluginsAccessibleTo(plugins, role) {
  const rank = ROLE_RANK[role] || 0;
  return plugins.filter(p => rank >= (ROLE_RANK[p.minRole] || 0));
}
