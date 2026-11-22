#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { previewConfiguration, buildSeededPreview, previewDashboardTarget, previewFrontendEnvironment } from './preview-build.mjs';
import { createPrivateOutput } from './local-integration-config.mjs';
import { frontendOnlyEnvironment, frontendTarget } from './frontend-target.mjs';

process.umask(0o077);
const root = process.cwd();
const cli = path.join(root, 'node_modules/convex/bin/main.js');
const secrets = [process.env.CONVEX_DEPLOY_KEY, process.env.CLERK_SECRET_KEY, process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY];
/** Capture CLI output privately; seed results contain guest tokens and must never reach build logs. */
async function run(command, args, env, visible = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const output = createPrivateOutput(line => process.stdout.write(line), secrets);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; if (visible) output.write(chunk); });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; if (visible) output.write(chunk); });
    child.on('error', () => reject(new Error('Build command could not start')));
    child.on('close', code => { output.end(); if (code) reject(new Error(stderr || `Build command failed (${code})`)); else resolve(stdout.trim()); });
  });
}
let work;
try {
  const target = frontendTarget(process.env);
  const label = 'TanStack Start';
  if (process.env.VERCEL_ENV === 'production') {
    if (process.env.VERCEL !== '1') throw new Error('Production builds run only on Vercel');
    if (target.frontendOnlyUrl) {
      // Staged rollout: the backend is already deployed; build only the frontend against it.
      console.log(`Frontend-only production build (${label}) against the existing backend; no Convex deploy.`);
      await run('bun', ['run', target.script], frontendOnlyEnvironment(process.env, target.frontendOnlyUrl), true);
    } else {
      if (!/^prod:wary-toad-189\|[^\s|]+$/.test(process.env.CONVEX_DEPLOY_KEY || '')) throw new Error('Production requires its explicit deployment key; Preview keys cannot target production');
      await run(process.execPath, [cli, 'deploy', '--typecheck', 'enable', '--cmd-url-env-var-name', target.urlEnv, '--cmd', `bun run ${target.script}`], process.env, true);
    }
  } else if (target.frontendOnlyUrl) {
    if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'preview') throw new Error('Frontend-only Preview builds run only in the Vercel Preview environment');
    console.log(`Frontend-only Preview build (${label}) against an existing preview backend; no Convex deploy or seed.`);
    await run('bun', ['run', target.script], previewFrontendEnvironment(process.env, target.frontendOnlyUrl), true);
  } else {
    const { branch } = previewConfiguration(process.env);
    work = await fs.mkdtemp(path.join(os.tmpdir(), '360-preview-build-'));
    const home = path.join(work, 'home');
    await fs.mkdir(home, { mode: 0o700 });
    // --env-file makes the installed CLI ignore process.env's deploy key.
    const envFile = path.join(work, 'preview.env');
    await fs.writeFile(envFile, `CONVEX_DEPLOY_KEY=${process.env.CONVEX_DEPLOY_KEY}\n`, { mode: 0o600 });
    const targetFile = path.join(work, 'target');
    const env = { ...process.env, HOME: home, CONVEX_AGENT_MODE: 'anonymous', CONVEX_DEPLOYMENT: '', CONVEX_SELF_HOSTED_URL: '', CONVEX_SELF_HOSTED_ADMIN_KEY: '', PHASE3F_TARGET_FILE: targetFile, PHASE3F_ENV_FILE: envFile };
    const convex = args => run(process.execPath, [cli, ...args, '--env-file', envFile], env);
    const result = await buildSeededPreview({
      deploy: async () => {
        await convex(['deploy', '--typecheck', 'enable', '--preview-name', branch, '--cmd-url-env-var-name', target.urlEnv, '--cmd', 'node scripts/preview-capture.mjs']);
        return await fs.readFile(targetFile, 'utf8');
      },
      resolve: async () => {
        const result = await convex(['dashboard', '--no-open', '--preview-name', branch]);
        return previewDashboardTarget(result);
      },
      seed: () => convex(['run', '--preview-name', branch, 'maintenance/seed:seedAll', '{"scenario":"demo-resort"}']),
      build: async url => {
        console.log(`Preview backend deployed; empty-only seed complete. Building ${label}.`);
        await run('bun', ['run', target.script], previewFrontendEnvironment(env, url), true);
      },
    });
    console.log(`Preview initialization: ${result}.`);
  }
} catch (error) {
  const output = createPrivateOutput(line => process.stderr.write(line), secrets);
  output.write(`Vercel build failed: ${error.message}\n`); output.end();
  process.exitCode = 1;
} finally {
  if (work) await fs.rm(work, { recursive: true, force: true });
}
