#!/usr/bin/env bash
# Usage: ./reset-password.sh <new-password> [username]
set -euo pipefail
PASS="${1:?usage: reset-password.sh <new-password> [username]}"
USER="${2:-admin}"

cd /root/webpanel/backend
node -e "
import('./src/db.js').then(async m => {
  m.initDb('./data/panel.db');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = bcrypt.hashSync('$PASS', 10);
  const db = m.getDb();
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, '$USER');
  if (r.changes === 0) {
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run('$USER', hash, 'admin', Date.now());
    console.log('user created: $USER');
  } else {
    console.log('password updated for: $USER');
  }
});
"
