import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DUAL_ENTRY_CHECKPOINT_SHA } from '../../scripts/dual-entry-checkpoint.mjs';
import { frontendOnlyEnvironment, frontendTarget, productionConvexUrl } from '../../scripts/frontend-target.mjs';
import { checkDevArgs, devFrontendCommand } from '../../scripts/local-dev-config.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const scripts = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
const preview = 'https://preview-example-123.convex.cloud';

describe('default frontend entry', () => {
  it('ships TanStack Start as the only entry; the Next entry is rebuilt only from the dual-entry checkpoint', () => {
    expect(scripts.build).toBe('node scripts/heavy.mjs vite build --config vite.start.config.ts');
    expect(scripts.preview).toBe('node .output/server/index.mjs');
    for (const name of ['build:next', 'preview:next', 'dev:next', 'build:start', 'preview:start', 'test:e2e:start', 'bench:routes:start']) {
      expect(scripts[name], name).toBeUndefined();
    }
    expect(Object.values(scripts).some((command) => /\bnext (build|start|dev)\b/.test(command))).toBe(false);
    // The full verification gate builds the shipping entry.
    expect(scripts.verify).toBe('node scripts/heavy.mjs node scripts/run-checks.mjs check test:unit build');
    expect(scripts['vercel-build']).toBe('node scripts/run-checks.mjs --parallel typecheck:app typecheck:tests && node scripts/vercel-build.mjs');
  });

  it('selects the Other framework preset in source so Vercel uses the Nitro Build Output API', () => {
    // Overrides the shared project preset per deployment; the dashboard setting is untouched.
    expect(JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'))).toEqual({
      framework: null,
      buildCommand: 'npx --yes bun@1.4.5 run vercel-build',
      installCommand: 'npx --yes bun@1.4.5 install --frozen-lockfile',
    });
  });

  it('selects Start for every Vercel build and refuses the retired Next entry by name', () => {
    expect(frontendTarget({})).toEqual({ frontend: 'start', script: 'build', urlEnv: 'VITE_CONVEX_URL' });
    expect(frontendTarget({ FRONTEND: 'start' }).frontend).toBe('start');
    // Former opt-in flags are harmless: Start is the only entry.
    expect(frontendTarget({ START_PREVIEW: '1', START_PRODUCTION: '1' }).frontend).toBe('start');
    expect(() => frontendTarget({ FRONTEND: 'next' })).toThrow(`deploy dual-entry checkpoint ${DUAL_ENTRY_CHECKPOINT_SHA} with its own FRONTEND=next vercel-build`);
    expect(() => frontendTarget({ FRONTEND: 'next' })).toThrow('plus "framework": "nextjs" in its vercel.json');
    expect(() => frontendTarget({ FRONTEND: 'next' })).toThrow('verified Stage 0 Next deployment');
    expect(() => frontendTarget({ VERCEL_ENV: 'production', FRONTEND: 'next', FRONTEND_ONLY_CONVEX_URL: productionConvexUrl })).toThrow('retired');
    for (const value of ['Next', 'nextjs', 'vite', '1']) expect(() => frontendTarget({ FRONTEND: value })).toThrow('FRONTEND');
  });

  it('builds frontend-only against an existing backend without crossing production and Preview', () => {
    expect(frontendTarget({ VERCEL_ENV: 'production', FRONTEND_ONLY_CONVEX_URL: productionConvexUrl }).frontendOnlyUrl).toBe(productionConvexUrl);
    expect(frontendTarget({ VERCEL_ENV: 'production', FRONTEND_ONLY_CONVEX_URL: `${productionConvexUrl}/` })).toMatchObject({ frontend: 'start', frontendOnlyUrl: productionConvexUrl });
    for (const url of [preview, 'https://optimistic-turtle-573.convex.cloud', 'http://wary-toad-189.convex.cloud', 'https://wary-toad-189.convex.cloud.evil.test']) {
      expect(() => frontendTarget({ VERCEL_ENV: 'production', FRONTEND_ONLY_CONVEX_URL: url })).toThrow();
    }
    expect(frontendTarget({ VERCEL_ENV: 'preview', FRONTEND_ONLY_CONVEX_URL: preview }).frontendOnlyUrl).toBe(preview);
    for (const url of [productionConvexUrl, 'https://optimistic-turtle-573.convex.cloud', `${preview}/path`]) {
      expect(() => frontendTarget({ VERCEL_ENV: 'preview', FRONTEND_ONLY_CONVEX_URL: url })).toThrow();
    }
    expect(frontendOnlyEnvironment({ NODE_ENV: 'production' }, productionConvexUrl)).toMatchObject({
      NEXT_PUBLIC_CONVEX_URL: productionConvexUrl, VITE_CONVEX_URL: productionConvexUrl,
      NEXT_PUBLIC_CONVEX_SITE_URL: 'https://wary-toad-189.convex.site', VITE_CONVEX_SITE_URL: 'https://wary-toad-189.convex.site',
    });
  });

  it('refuses unsafe Vercel builds before running any deploy or frontend build', async () => {
    const run = (env: Record<string, string>) => promisify(execFile)(process.execPath, ['scripts/vercel-build.mjs'], {
      cwd: root, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env }, timeout: 15000,
    });
    await expect(run({ VERCEL: '1', VERCEL_ENV: 'production', FRONTEND: 'nextjs' })).rejects.toMatchObject({ stderr: expect.stringContaining('FRONTEND must be') });
    await expect(run({ VERCEL: '1', VERCEL_ENV: 'preview', FRONTEND: 'next' })).rejects.toMatchObject({ stderr: expect.stringContaining('Next entry was retired') });
    await expect(run({ VERCEL: '1', VERCEL_ENV: 'production', FRONTEND_ONLY_CONVEX_URL: preview })).rejects.toMatchObject({ stderr: expect.stringContaining('production backend URL exactly') });
    await expect(run({ VERCEL: '1', VERCEL_ENV: 'production' })).rejects.toMatchObject({ stderr: expect.stringContaining('explicit deployment key') });
    await expect(run({ VERCEL: '0', VERCEL_ENV: 'production', FRONTEND_ONLY_CONVEX_URL: productionConvexUrl })).rejects.toMatchObject({ stderr: expect.stringContaining('only on Vercel') });
    await expect(run({ VERCEL: '0', VERCEL_ENV: 'preview', FRONTEND_ONLY_CONVEX_URL: preview })).rejects.toMatchObject({ stderr: expect.stringContaining('Vercel Preview environment') });
  });

  it('serves Start in local development and explains the removed --next option', () => {
    expect(() => checkDevArgs([])).not.toThrow();
    expect(() => checkDevArgs(['--next'])).toThrow('removed with the Next entry');
    for (const args of [['--reset'], ['--start']]) expect(() => checkDevArgs(args)).toThrow('takes no arguments');
    expect(devFrontendCommand('/repo', 3123)).toEqual(['/repo/node_modules/vite/bin/vite.js', 'dev', '--config', 'vite.start.config.ts', '--host', 'localhost', '--port', '3123', '--strictPort']);
    // test:dev waits for this exact readiness text.
    expect(readFileSync(path.join(root, 'scripts/local-dev.mjs'), 'utf8')).toContain('Local development ready at http://localhost:${config.port} (TanStack Start)');
  });
});
