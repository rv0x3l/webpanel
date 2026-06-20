import { Client } from 'ssh2';

const STATIC_SCRIPT = `
echo "==HOSTNAME=="; uname -n
echo "==KERNEL==";   uname -r
echo "==ARCH==";     uname -m
echo "==OS==";       (cat /etc/os-release 2>/dev/null || true)
echo "==CPU==";      (lscpu 2>/dev/null || true)
echo "==MEMTOTAL=="; awk '/^MemTotal:/{print $2}' /proc/meminfo
`;

const LIVE_SCRIPT = `
echo "==CPU=="; head -1 /proc/stat
echo "==NCPU==";  grep -c ^processor /proc/cpuinfo
echo "==MEM=="; cat /proc/meminfo
echo "==LOAD=="; cat /proc/loadavg
echo "==UPTIME=="; cat /proc/uptime
echo "==NET=="; cat /proc/net/dev
echo "==DISK=="; df -PB1 -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null
echo "==PROC=="; ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu --no-headers 2>/dev/null | head -10
echo "==PROCALL=="; ps -e --no-headers 2>/dev/null | wc -l
`;

function connectSsh(cfg) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const opts = {
      host: cfg.host,
      port: cfg.port || 22,
      username: cfg.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
    };
    if (cfg.auth_type === 'key' && cfg.private_key) opts.privateKey = cfg.private_key;
    else opts.password = cfg.password || '';

    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect(opts);
  });
}

function execOnConn(conn, cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('exec timeout')), timeout);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); return reject(err); }
      let out = '';
      stream.on('data', d => (out += d.toString()));
      stream.stderr.on('data', () => {});
      stream.on('close', () => { clearTimeout(t); resolve(out); });
    });
  });
}

function splitSections(raw) {
  const out = {};
  let cur = null;
  for (const line of raw.split('\n')) {
    const m = line.match(/^==([A-Z]+)==$/);
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur) out[cur].push(line);
  }
  return out;
}

export class RemoteStats {
  constructor(cfg) {
    this.cfg = cfg;
    this.conn = null;
    this.lastCpu = null;
    this.lastNet = null;
    this.lastNetTs = null;
    this.staticCache = null;
  }

  async ensure() {
    if (this.conn) return;
    this.conn = await connectSsh(this.cfg);
    this.conn.on('close', () => { this.conn = null; });
    this.conn.on('end',   () => { this.conn = null; });
  }

  close() {
    try { this.conn?.end(); } catch {}
    this.conn = null;
  }

  async getStatic() {
    if (this.staticCache) return this.staticCache;
    await this.ensure();
    const raw = await execOnConn(this.conn, STATIC_SCRIPT);
    const s = splitSections(raw);

    const osRel = {};
    for (const line of s.OS || []) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
      if (m) osRel[m[1]] = m[2];
    }
    const distro = osRel.PRETTY_NAME || osRel.NAME || 'Linux';

    let cpuBrand = '', cpuCores = 0, cpuPhys = 0, cpuSpeed = 0;
    for (const line of s.CPU || []) {
      const [k, ...rest] = line.split(':');
      const v = rest.join(':').trim();
      if (/^Model name/i.test(k)) cpuBrand = v;
      else if (/^CPU\(s\)/i.test(k.trim())) cpuCores = parseInt(v, 10) || cpuCores;
      else if (/^Core\(s\) per socket/i.test(k)) cpuPhys = parseInt(v, 10) || cpuPhys;
      else if (/^CPU max MHz/i.test(k)) cpuSpeed = parseFloat(v) / 1000;
      else if (!cpuSpeed && /^CPU MHz/i.test(k)) cpuSpeed = parseFloat(v) / 1000;
    }

    const memTotalKB = parseInt((s.MEMTOTAL?.[0] || '0').trim(), 10);

    this.staticCache = {
      hostname: (s.HOSTNAME?.[0] || '').trim(),
      os: distro,
      kernel: (s.KERNEL?.[0] || '').trim(),
      arch: (s.ARCH?.[0] || '').trim(),
      cpu: {
        manufacturer: '',
        brand: cpuBrand,
        cores: cpuCores,
        physicalCores: cpuPhys || cpuCores,
        speed: cpuSpeed,
      },
      system: { manufacturer: 'remote', model: this.cfg.host },
      memTotal: memTotalKB * 1024,
    };
    return this.staticCache;
  }

  async getLive() {
    await this.ensure();
    const raw = await execOnConn(this.conn, LIVE_SCRIPT);
    const s = splitSections(raw);
    const nowTs = Date.now();

    // CPU
    const cpuFields = (s.CPU?.[0] || '').split(/\s+/).slice(1).map(Number);
    const idleNow  = (cpuFields[3] || 0) + (cpuFields[4] || 0); // idle + iowait
    const totalNow = cpuFields.reduce((a, b) => a + b, 0);
    let cpuLoad = 0;
    if (this.lastCpu) {
      const idleDelta  = idleNow  - this.lastCpu.idle;
      const totalDelta = totalNow - this.lastCpu.total;
      if (totalDelta > 0) cpuLoad = 100 * (1 - idleDelta / totalDelta);
    }
    this.lastCpu = { idle: idleNow, total: totalNow };

    // MEM (/proc/meminfo, units kB)
    const mem = {};
    for (const line of s.MEM || []) {
      const m = line.match(/^([A-Za-z_()]+):\s+(\d+)/);
      if (m) mem[m[1]] = parseInt(m[2], 10) * 1024;
    }
    const memTotal = mem.MemTotal || 0;
    const memAvail = mem.MemAvailable ?? mem.MemFree ?? 0;
    const memUsed  = memTotal - memAvail;

    // Uptime
    const uptime = parseFloat((s.UPTIME?.[0] || '0').split(/\s+/)[0]) || 0;

    // Net: lines 3+ are interfaces
    const ifaces = [];
    let totalRx = 0, totalTx = 0;
    for (const line of (s.NET || []).slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(/:$/, '');
      if (iface === 'lo' || !iface) continue;
      const rx = parseInt(parts[1], 10) || 0;
      const tx = parseInt(parts[9], 10) || 0;
      totalRx += rx; totalTx += tx;
      ifaces.push({ iface, rx_bytes: rx, tx_bytes: tx, rx_sec: 0, tx_sec: 0 });
    }
    let rxSec = 0, txSec = 0;
    if (this.lastNet && this.lastNetTs) {
      const dt = (nowTs - this.lastNetTs) / 1000;
      if (dt > 0) {
        rxSec = Math.max(0, (totalRx - this.lastNet.rx) / dt);
        txSec = Math.max(0, (totalTx - this.lastNet.tx) / dt);
      }
    }
    this.lastNet = { rx: totalRx, tx: totalTx };
    this.lastNetTs = nowTs;
    if (ifaces[0]) { ifaces[0].rx_sec = rxSec; ifaces[0].tx_sec = txSec; }

    // Disk
    const disks = (s.DISK || []).slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) return null;
      const size = parseInt(parts[1], 10) || 0;
      const used = parseInt(parts[2], 10) || 0;
      const avail = parseInt(parts[3], 10) || 0;
      return {
        fs: parts[0],
        type: '',
        mount: parts.slice(5).join(' '),
        size, used, available: avail,
        use: size > 0 ? (100 * used / size) : 0,
      };
    }).filter(Boolean);

    // Processes (top)
    const top = (s.PROC || []).map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) return null;
      const [pid, user, cpu, memp, ...rest] = parts;
      const name = rest.join(' ');
      return {
        pid: parseInt(pid, 10),
        name,
        user,
        cpu: parseFloat(cpu) || 0,
        mem: parseFloat(memp) || 0,
        command: name,
      };
    }).filter(Boolean);

    const allProcs = parseInt((s.PROCALL?.[0] || '0').trim(), 10) || 0;

    return {
      ts: nowTs,
      uptime,
      cpu: { load: cpuLoad, user: 0, system: 0, idle: 0, perCore: [], temp: null },
      mem: {
        total: memTotal,
        used: memUsed,
        free: mem.MemFree || 0,
        active: mem.Active || 0,
        available: memAvail,
        swapTotal: mem.SwapTotal || 0,
        swapUsed: (mem.SwapTotal || 0) - (mem.SwapFree || 0),
      },
      disks,
      net: ifaces,
      processes: { all: allProcs, running: 0, blocked: 0, sleeping: 0, top },
      remote: true,
    };
  }
}
