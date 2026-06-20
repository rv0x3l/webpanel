import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

let db;

export function initDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'password',
      password TEXT,
      private_key TEXT,
      vnc_host TEXT,
      vnc_port INTEGER,
      vnc_password TEXT,
      tags TEXT,
      is_local INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL DEFAULT 'read',
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY(plugin, key)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      source TEXT,
      message TEXT,
      data TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Migration: add TOTP columns to users if missing
  const cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
  if (!cols.includes('totp_secret')) db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`);
  if (!cols.includes('totp_enabled')) db.exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`);

  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function ensureAdmin(username, password) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, hash, 'admin', Date.now());
    console.log(`[db] Created admin user: ${username}`);
  }
}

export function ensureLocalServer() {
  const existing = db.prepare('SELECT id FROM servers WHERE is_local = 1').get();
  if (!existing) {
    db.prepare(
      `INSERT INTO servers (name, host, port, username, auth_type, is_local, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('This server', 'localhost', 22, 'root', 'local', 1, 'local,host', Date.now());
    console.log('[db] Added local server entry');
  }
}
