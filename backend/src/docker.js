import { runCommand } from './exec.js';

const ID_RE = /^[a-zA-Z0-9_.-]+$/;
const ALLOWED_OPS = new Set(['start', 'stop', 'restart', 'pause', 'unpause', 'kill', 'rm']);

function safeId(id) {
  if (!id || !ID_RE.test(id)) throw new Error('invalid container id');
  return id;
}

export async function dockerAvailable() {
  const r = await runCommand('command -v docker >/dev/null && docker info --format "{{.ServerVersion}}"', 5000);
  return r.ok ? r.stdout.trim() : null;
}

export async function listContainers({ all = true } = {}) {
  const flag = all ? '-a' : '';
  // Use a custom format with tab separators to parse easily
  const fmt = '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}\t{{.CreatedAt}}';
  const r = await runCommand(`docker ps ${flag} --format '${fmt}'`);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map(line => {
    const [id, name, image, state, status, ports, created] = line.split('\t');
    return { id, name, image, state, status, ports, created };
  });
}

export async function listImages() {
  const fmt = '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}';
  const r = await runCommand(`docker images --format '${fmt}'`);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map(line => {
    const [id, repository, tag, size, created] = line.split('\t');
    return { id, repository, tag, size, created };
  });
}

export async function containerAction(id, op) {
  const cid = safeId(id);
  if (!ALLOWED_OPS.has(op)) throw new Error('invalid op');
  const cmd = op === 'rm' ? `docker rm -f ${cid}` : `docker ${op} ${cid}`;
  return runCommand(cmd);
}

export async function containerLogs(id, lines = 200) {
  const cid = safeId(id);
  const ln = Math.max(10, Math.min(5000, parseInt(lines, 10) || 200));
  const r = await runCommand(`docker logs --tail ${ln} --timestamps ${cid} 2>&1`);
  return { ok: r.ok, output: r.stdout || r.stderr };
}

export async function containerInspect(id) {
  const cid = safeId(id);
  const r = await runCommand(`docker inspect ${cid}`);
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout)[0]; } catch { return null; }
}

export async function containerStats(id) {
  const cid = safeId(id);
  const fmt = '{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}';
  const r = await runCommand(`docker stats --no-stream --format '${fmt}' ${cid}`);
  if (!r.ok) return null;
  const [cpu, mem, memPerc, net, block, pids] = r.stdout.trim().split('\t');
  return { cpu, mem, memPerc, net, block, pids };
}

export async function imageRemove(id) {
  const iid = safeId(id);
  return runCommand(`docker rmi ${iid}`);
}

export async function imagePull(name) {
  // Allow image names like nginx, nginx:latest, registry.example.com/foo/bar:tag
  if (!/^[a-zA-Z0-9_./:-]+$/.test(name)) throw new Error('invalid image name');
  return runCommand(`docker pull ${name}`, 120000);
}

export async function prune(target) {
  const allowed = { containers: 'docker container prune -f', images: 'docker image prune -af', volumes: 'docker volume prune -f', system: 'docker system prune -af' };
  if (!allowed[target]) throw new Error('invalid prune target');
  return runCommand(allowed[target], 120000);
}
