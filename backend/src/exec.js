import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function runCommand(cmd, timeout = 30000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      code: err.code,
    };
  }
}

// Action helpers
export const actions = {
  reboot: () => runCommand('shutdown -r +1 "Reboot scheduled via WebPanel"'),
  poweroff: () => runCommand('shutdown -h +1 "Shutdown scheduled via WebPanel"'),
  cancelShutdown: () => runCommand('shutdown -c'),
  killProcess: (pid, signal = 'TERM') => runCommand(`kill -${signal} ${parseInt(pid, 10)}`),
  serviceAction: (name, action) => {
    const safeName = String(name).replace(/[^a-zA-Z0-9._@-]/g, '');
    const safeAction = ['start', 'stop', 'restart', 'reload', 'status'].includes(action) ? action : 'status';
    return runCommand(`systemctl ${safeAction} ${safeName}`);
  },
};
