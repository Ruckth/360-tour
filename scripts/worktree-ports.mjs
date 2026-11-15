import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';

export const portsFilename = '.worktree-ports.json';

/** @param {string} root @param {number} [start] */
export function derivePort(root, start = 3100) {
  return start + createHash('sha256').update(root).digest().readUInt32BE(0) % 900;
}

/** @param {number} preferred @param {number} start */
export async function availablePort(preferred, start) {
  for (let offset = 0; offset < 900; offset++) {
    const port = start + (preferred - start + offset) % 900;
    const free = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', error => {
        if ('code' in error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) resolve(false);
        else reject(error);
      });
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free worktree port in ${start}–${start + 899}`);
}

/** @param {string} root @returns {Record<string, number>} */
export function readWorktreePorts(root) {
  let ports;
  try { ports = JSON.parse(fs.readFileSync(path.join(root, portsFilename), 'utf8')); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}; throw error; }
  if (!ports || typeof ports !== 'object' || Array.isArray(ports) ||
      !Object.entries(ports).every(([key, value]) =>
        ['LOCAL_DEV_PORT', 'BOOKING_UI_PORT'].includes(key) && Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65535)) {
    throw new Error(`Invalid ${portsFilename}; rerun pnpm worktree:setup`);
  }
  return ports;
}

/** @param {string} root @param {Record<string, string | undefined>} [env] */
export function bookingUIPort(root, env = process.env) {
  const port = Number(env.BOOKING_UI_PORT ?? env.E2E_COMPONENT_PORT ?? readWorktreePorts(root).BOOKING_UI_PORT ?? 4319);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid BOOKING_UI_PORT');
  return port;
}

/** @param {string} root @param {number} fallback @param {Record<string, string | undefined>} [env] */
export function localDevPort(root, fallback, env = process.env) {
  const port = Number(env.LOCAL_DEV_PORT ?? readWorktreePorts(root).LOCAL_DEV_PORT ?? fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid LOCAL_DEV_PORT');
  return port;
}
