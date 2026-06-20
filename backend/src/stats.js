import si from 'systeminformation';

let staticCache = null;

export async function getStatic() {
  if (staticCache) return staticCache;
  const [osInfo, cpu, system, baseboard, mem] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.system(),
    si.baseboard(),
    si.mem(),
  ]);
  staticCache = {
    hostname: osInfo.hostname,
    os: `${osInfo.distro} ${osInfo.release}`,
    kernel: osInfo.kernel,
    arch: osInfo.arch,
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed,
    },
    system: {
      manufacturer: system.manufacturer,
      model: system.model,
    },
    memTotal: mem.total,
  };
  return staticCache;
}

export async function getLive() {
  const [load, mem, fs, net, temp, processes, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.cpuTemperature().catch(() => ({ main: null })),
    si.processes().catch(() => ({ all: 0, running: 0, blocked: 0, sleeping: 0, list: [] })),
    si.time(),
  ]);

  return {
    ts: Date.now(),
    uptime: time.uptime,
    cpu: {
      load: load.currentLoad,
      user: load.currentLoadUser,
      system: load.currentLoadSystem,
      idle: load.currentLoadIdle,
      perCore: load.cpus.map(c => c.load),
      temp: temp.main,
    },
    mem: {
      total: mem.total,
      used: mem.used,
      free: mem.free,
      active: mem.active,
      available: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    },
    disks: fs.map(d => ({
      fs: d.fs,
      type: d.type,
      mount: d.mount,
      size: d.size,
      used: d.used,
      available: d.available,
      use: d.use,
    })),
    net: net.map(n => ({
      iface: n.iface,
      rx_sec: n.rx_sec,
      tx_sec: n.tx_sec,
      rx_bytes: n.rx_bytes,
      tx_bytes: n.tx_bytes,
    })),
    processes: {
      all: processes.all,
      running: processes.running,
      blocked: processes.blocked,
      sleeping: processes.sleeping,
      top: (processes.list || [])
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 10)
        .map(p => ({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu,
          mem: p.mem,
          user: p.user,
          command: p.command,
        })),
    },
  };
}

export async function getServices() {
  try {
    const services = await si.services('*');
    return services.slice(0, 50).map(s => ({
      name: s.name,
      running: s.running,
      startmode: s.startmode,
      pids: s.pids,
      cpu: s.cpu,
      mem: s.mem,
    }));
  } catch {
    return [];
  }
}

export async function getDockerInfo() {
  try {
    const [info, containers] = await Promise.all([
      si.dockerInfo(),
      si.dockerContainers(true),
    ]);
    return {
      info: {
        containers: info.containers,
        containersRunning: info.containersRunning,
        containersPaused: info.containersPaused,
        containersStopped: info.containersStopped,
        images: info.images,
      },
      containers: containers.map(c => ({
        id: c.id?.slice(0, 12),
        name: c.name,
        image: c.image,
        state: c.state,
        started: c.startedAt,
      })),
    };
  } catch {
    return { info: null, containers: [] };
  }
}
