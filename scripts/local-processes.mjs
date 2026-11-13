import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createPrivateOutput } from './local-integration-config.mjs';

/** Process groups belong to one invocation; never discover or kill other processes.
 * @param {string[]} secrets
 */
export function localProcesses(secrets) {
  /** @type {ReturnType<typeof spawn>[]} */
  const children = [];
  let stopping = false;
  /** @type {(error: Error) => void} */
  let fail;
  const failure = new Promise((_, reject) => { fail = reject; });
  // A child can exit while startup is between awaits. Retain the failure until raced.
  void failure.catch(() => {});
  return {
    failure,
    /** @param {string} command @param {string[]} args @param {string} cwd @param {NodeJS.ProcessEnv} env */
    launch(command, args, cwd, env) {
      if (stopping) throw new Error('Development loop is stopping');
      const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        const output = createPrivateOutput(line => destination.write(line), secrets);
        stream.setEncoding('utf8');
        stream.on('data', output.write);
        stream.on('end', output.end);
      }
      child.on('error', () => fail(new Error(`${command} could not start`)));
      child.on('exit', code => { if (!stopping) fail(new Error(`${command} exited (${code}); stopping the development loop`)); });
      return child;
    },
    async stop() {
      stopping = true;
      for (const child of [...children].reverse()) {
        if (!child.pid) continue;
        const signal = (name) => { try { process.kill(-child.pid, name); } catch { if (child.exitCode === null && child.signalCode === null) child.kill(name); } };
        signal('SIGTERM');
        if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
        // Descendants can survive their immediate parent; signal only our original group.
        signal('SIGKILL');
      }
    },
  };
}

/** @param {() => Promise<boolean>} check @param {string} label @param {number} [timeout] */
export async function waitFor(check, label, timeout = 180000, signal) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
