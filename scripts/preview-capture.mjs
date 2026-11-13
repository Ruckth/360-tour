// Convex --cmd runs after claim/defaults but BEFORE push. Refuse inherited providers here.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { previewConfiguration, previewUrl, previewDashboardTarget, assertPreviewProvidersDisabled } from './preview-build.mjs';
const { branch } = previewConfiguration(process.env);
if (!process.env.PHASE3F_TARGET_FILE || !process.env.PHASE3F_ENV_FILE) throw new Error('Missing private Preview configuration');
const url = previewUrl(process.env.NEXT_PUBLIC_CONVEX_URL);
async function convex(args) {
  try {
    const result = await promisify(execFile)(process.execPath, [path.resolve('node_modules/convex/bin/main.js'), ...args, '--env-file', process.env.PHASE3F_ENV_FILE], { env: process.env, timeout: 60000, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  } catch { throw new Error('Pre-push Preview verification failed; no backend push or seed allowed'); }
}
if (previewDashboardTarget(await convex(['dashboard', '--no-open', '--preview-name', branch])) !== url) throw new Error('Pre-push branch identity differs from claimed Preview');
assertPreviewProvidersDisabled(await convex(['env', 'list', '--preview-name', branch]));
fs.writeFileSync(process.env.PHASE3F_TARGET_FILE, url, { mode: 0o600, flag: 'wx' });
