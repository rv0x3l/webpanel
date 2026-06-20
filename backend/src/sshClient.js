import { Client } from 'ssh2';

export function createSshShell(serverCfg, { cols = 80, rows = 24 } = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const cfg = {
      host: serverCfg.host,
      port: serverCfg.port || 22,
      username: serverCfg.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
    };
    if (serverCfg.auth_type === 'key' && serverCfg.private_key) {
      cfg.privateKey = serverCfg.private_key;
    } else {
      cfg.password = serverCfg.password || '';
    }

    conn.on('ready', () => {
      conn.shell({ cols, rows, term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        resolve({ conn, stream });
      });
    });
    conn.on('error', reject);
    conn.connect(cfg);
  });
}

export async function execOnServer(serverCfg, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const cfg = {
      host: serverCfg.host,
      port: serverCfg.port || 22,
      username: serverCfg.username,
      readyTimeout: 15000,
    };
    if (serverCfg.auth_type === 'key' && serverCfg.private_key) {
      cfg.privateKey = serverCfg.private_key;
    } else {
      cfg.password = serverCfg.password || '';
    }

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', d => (stdout += d.toString()));
        stream.stderr.on('data', d => (stderr += d.toString()));
        stream.on('close', code => {
          conn.end();
          resolve({ ok: code === 0, code, stdout, stderr });
        });
      });
    });
    conn.on('error', reject);
    conn.connect(cfg);
  });
}
