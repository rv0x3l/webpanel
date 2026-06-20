import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import express from 'express';

const TEXT_EXT = /\.(txt|md|conf|cfg|ini|json|yaml|yml|toml|sh|bash|zsh|py|js|ts|jsx|tsx|html|css|scss|sql|rs|go|c|h|cpp|hpp|java|rb|php|service|log|env|gitignore|dockerfile)$/i;
const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5MB

function safeResolve(rootBase, p) {
  const resolved = path.resolve(rootBase, p.replace(/^\/+/, '') || '.');
  // Enforce root containment
  if (!resolved.startsWith(rootBase) && resolved !== rootBase) throw new Error('path escapes root');
  return resolved;
}

function getRoot(ctx) {
  return ctx.settings.get('root', '/') || '/';
}

async function listDir(p) {
  const ents = await fs.readdir(p, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    const full = path.join(p, e.name);
    let st;
    try { st = await fs.lstat(full); } catch { continue; }
    out.push({
      name: e.name,
      type: e.isDirectory() ? 'dir' : (e.isSymbolicLink() ? 'link' : 'file'),
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      mode: st.mode & 0o777,
    });
  }
  out.sort((a, b) => (a.type === 'dir' ? -1 : 1) - (b.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name));
  return out;
}

export default async function init(ctx) {
  ctx.router.get('/list', async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, req.query.path || '/');
      const items = await listDir(target);
      res.json({ path: target, root: rootBase, items });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.get('/read', async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, req.query.path || '/');
      const st = await fs.stat(target);
      if (st.isDirectory()) return res.status(400).json({ error: 'is a directory' });
      const ext = path.extname(target).toLowerCase();
      const isText = TEXT_EXT.test(target) || st.size < 64 * 1024;
      if (isText && st.size <= MAX_TEXT_SIZE) {
        const content = await fs.readFile(target, 'utf-8');
        return res.json({ path: target, size: st.size, mtime: st.mtimeMs, content, encoding: 'utf-8' });
      }
      res.json({ path: target, size: st.size, mtime: st.mtimeMs, binary: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.post('/save', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, req.body?.path || '');
      const content = String(req.body?.content ?? '');
      await fs.writeFile(target, content, 'utf-8');
      ctx.auditAs(req.user.id, 'save', { path: target, bytes: content.length });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.post('/mkdir', async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, req.body?.path || '');
      await fs.mkdir(target, { recursive: false });
      ctx.auditAs(req.user.id, 'mkdir', { path: target });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.post('/rename', async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const from = safeResolve(rootBase, req.body?.from || '');
      const to   = safeResolve(rootBase, req.body?.to || '');
      await fs.rename(from, to);
      ctx.auditAs(req.user.id, 'rename', { from, to });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.delete('/delete', async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, req.query.path || '');
      const st = await fs.lstat(target);
      if (st.isDirectory()) await fs.rm(target, { recursive: true, force: false });
      else await fs.unlink(target);
      ctx.auditAs(req.user.id, 'delete', { path: target, dir: st.isDirectory() });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.get('/download', async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, req.query.path || '');
      const st = await fs.stat(target);
      if (st.isDirectory()) return res.status(400).json({ error: 'is a directory' });
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(target).replace(/"/g, '')}"`);
      res.setHeader('Content-Length', st.size);
      await pipeline(createReadStream(target), res);
    } catch (e) {
      if (!res.headersSent) res.status(400).json({ error: e.message });
    }
  });

  // Upload via base64 (no multipart dep). Body: { path, name, dataB64 }
  ctx.router.post('/upload', express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const rootBase = getRoot(ctx);
      const target = safeResolve(rootBase, path.join(req.body?.path || '/', req.body?.name || 'upload.bin'));
      const data = Buffer.from(req.body?.dataB64 || '', 'base64');
      await fs.writeFile(target, data);
      ctx.auditAs(req.user.id, 'upload', { path: target, bytes: data.length });
      res.json({ ok: true, path: target, size: data.length });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ctx.router.get('/root', (req, res) => res.json({ root: getRoot(ctx) }));
  ctx.router.post('/root', (req, res) => {
    const r = String(req.body?.root || '/');
    ctx.settings.set('root', r);
    ctx.auditAs(req.user.id, 'config.root', { root: r });
    res.json({ ok: true });
  });
}
