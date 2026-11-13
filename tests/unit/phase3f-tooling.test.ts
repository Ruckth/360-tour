import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readDevConfig, refuseInheritedTarget, devEnvironment, requireAnonymousState } from '../../scripts/local-dev-config.mjs';
import { buildSeededPreview, previewConfiguration, previewUrl, previewDashboardTarget, assertPreviewProvidersDisabled, previewFrontendEnvironment } from '../../scripts/preview-build.mjs';
import { seedEmpty } from '../../scripts/seed-empty.mjs';
import { testProjects } from '../../scripts/vitest-projects.mjs';

const keyHost = Buffer.from('tenant.clerk.accounts.dev$').toString('base64');
describe('persistent local development configuration', () => {
  it('requires private explicit Clerk test configuration and local owners; rejects deploy credentials', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3f-config-'));
    const file = path.join(dir, '.env.dev.local');
    const config = `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_${keyHost}\nCLERK_SECRET_KEY=sk_test_offlinefixture\nCLERK_JWT_ISSUER_DOMAIN=https://tenant.clerk.accounts.dev\nLOCAL_DEV_OWNER_EMAILS=owner+clerk_test@example.com\nLOCAL_DEV_PORT=3035\n`;
    try {
      await expect(readDevConfig(file)).rejects.toThrow('Create mode-600');
      await fs.writeFile(file, config, { mode: 0o600 });
      const parsed = await readDevConfig(file);
      expect(parsed.port).toBe(3035);
      const env = devEnvironment({ PATH: '/bin', CONVEX_DEPLOY_KEY: 'inherited', AI_API_KEY: 'inherited', RESEND_API_KEY: 'inherited' }, '/private/test-home', parsed);
      expect(env).toMatchObject({ HOME: '/private/test-home', CONVEX_DEPLOY_KEY: '', AI_API_KEY: '', RESEND_API_KEY: '', CONVEX_AGENT_MODE: 'anonymous' });
      for (const extra of ['CONVEX_DEPLOY_KEY=forbidden', 'STRIPE_SECRET_KEY=forbidden', 'LOCAL_DEV_OWNER_EMAILS=duplicate']) {
        await fs.writeFile(file, config + extra);
        await expect(readDevConfig(file)).rejects.toThrow('Unknown or duplicate');
      }
      for (const invalid of [config.replace('pk_test_', 'pk_live_'), config.replace('sk_test_', 'sk_live_'), config.replace('https://tenant.', 'https://other.'), config.replace('LOCAL_DEV_OWNER_EMAILS=owner+clerk_test@example.com', 'LOCAL_DEV_OWNER_EMAILS='), config.replace('3035', '99999')]) {
        await fs.writeFile(file, invalid);
        await expect(readDevConfig(file)).rejects.toThrow();
      }
      await fs.writeFile(file, config); await fs.chmod(file, 0o644);
      await expect(readDevConfig(file)).rejects.toThrow('regular mode-600');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('refuses every inherited deployment selector before a child starts', () => {
    for (const field of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_OVERRIDE_ACCESS_TOKEN', 'CONVEX_OVERRIDE_DEPLOYMENT_URL', 'NEXT_PUBLIC_CONVEX_URL', 'PUBLIC_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_SITE_URL']) expect(() => refuseInheritedTarget({ [field]: 'remote-or-shared' })).toThrow(`Unset inherited ${field}`);
    expect(() => refuseInheritedTarget({ CONVEX_DEPLOY_KEY: '' })).not.toThrow();
    const ports = { cloud: 3201, site: 3202 };
    expect(() => requireAnonymousState({ deploymentName: 'anonymous-owned', adminKey: 'offline-only', ports }, ports)).not.toThrow();
    for (const config of [{ deploymentName: 'wary-toad-189', adminKey: 'offline-only', ports }, { deploymentName: 'optimistic-turtle-573', adminKey: 'offline-only', ports }, { deploymentName: 'anonymous-owned\nCONVEX_DEPLOY_KEY=injected', adminKey: 'offline-only', ports }, { deploymentName: 'anonymous-owned', adminKey: '', ports }, { deploymentName: 'anonymous-owned', adminKey: 'offline-only', ports: { cloud: 9999, site: 3202 } }]) expect(() => requireAnonymousState(config, ports)).toThrow('Invalid isolated anonymous');
  });
  it('preserves nonempty data but propagates arbitrary deployment/seed failures', async () => {
    expect(await seedEmpty(async () => ({ ok: true }))).toBe('seeded');
    expect(await seedEmpty(async () => { throw new Error('Seed requires an empty database; orders is not empty'); })).toBe('preserved');
    for (const reason of ['Unauthorized', 'Seed requires an empty database', 'network failure', 'schema mismatch']) await expect(seedEmpty(async () => { throw new Error(reason); })).rejects.toThrow(reason);
  });
});

const env = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_REPO_OWNER: 'Ruckth', VERCEL_GIT_REPO_SLUG: '360-tour', CONVEX_DEPLOY_KEY: 'preview:test-team:test-project|offline-fixture', CONVEX_PREVIEW_TEAM: 'test-team', CONVEX_PREVIEW_PROJECT: 'test-project', CONVEX_PREVIEW_DEFAULT_BRANCH: 'main', VERCEL_GIT_COMMIT_REF: 't3/phase3f-local-dev-preview' };
describe('project-scoped Preview build', () => {
  it('rejects inherited provider values without printing them and pins Next dotenv overrides', () => {
    for (const listing of ['AI_API_KEY=private-fixture', "RESEND_API_KEY='private\nfixture'", 'STRIPE_SECRET_KEY=   ']) {
      expect(() => assertPreviewProvidersDisabled(listing)).toThrow('Disable Preview provider');
      try { assertPreviewProvidersDisabled(listing); } catch (error) { expect(String(error)).not.toContain('private'); }
    }
    expect(() => assertPreviewProvidersDisabled('AI_API_KEY=\nRESEND_API_KEY=\nADMIN_EMAILS=fixture')).not.toThrow();
    expect(previewFrontendEnvironment({ NODE_ENV: 'production', AI_API_KEY: 'private', MESSAGING_IMAGE_SECRET: 'private', NEXT_PUBLIC_SENTRY_DSN: 'private', CLERK_SECRET_KEY: 'test-fixture', VERCEL_URL: 'branch.example.test' }, 'https://preview-example-123.convex.cloud')).toMatchObject({ AI_API_KEY: '', MESSAGING_IMAGE_SECRET: '', NEXT_PUBLIC_SENTRY_DSN: '', CONVEX_DEPLOY_KEY: '', CLERK_SECRET_KEY: 'test-fixture', NEXT_PUBLIC_SITE_URL: 'https://branch.example.test' });
  });
  it('passes the Preview key through the real installed CLI env-file selection before any network authorization', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3f-cli-'));
    let authorized = false;
    let claim: { identifier?: string; reuse?: boolean } = {};
    const server = http.createServer((request, response) => {
      authorized = request.headers.authorization === `Bearer ${env.CONVEX_DEPLOY_KEY}`;
      let body = '';
      request.setEncoding('utf8').on('data', chunk => { body += chunk; });
      request.on('end', () => {
        if (request.url?.endsWith('/claim_preview_deployment')) claim = JSON.parse(body);
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 'Unauthorized', message: 'offline fixture unauthorized' }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    try {
      await expect(promisify(execFile)(process.execPath, ['scripts/vercel-build.mjs'], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: { NODE_ENV: 'test', PATH: process.env.PATH, ...env, CONVEX_PROVISION_HOST: `http://127.0.0.1:${address.port}`, HOME: dir }, timeout: 15000,
      })).rejects.toMatchObject({ stderr: expect.stringContaining('offline fixture unauthorized') });
      expect(authorized).toBe(true);
      // Test the installed CLI, not a mock: claiming must retain the branch DB.
      expect(claim).toMatchObject({ identifier: env.VERCEL_GIT_COMMIT_REF, reuse: true });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 20000);
  it('requires exact project scope, Vercel repository and a non-default branch', () => {
    expect(previewConfiguration(env).branch).toBe(env.VERCEL_GIT_COMMIT_REF);
    for (const mutation of [{ VERCEL_ENV: 'production' }, { VERCEL: '0' }, { CONVEX_PREVIEW_TEAM: 'wrong' }, { CONVEX_PREVIEW_PROJECT: 'wrong' }, { VERCEL_GIT_REPO_SLUG: 'other' }, { CONVEX_PREVIEW_DEFAULT_BRANCH: '' }, ...['main', 'master', 'default', 'production', 'bad branch', 'bad/../branch', 'trailing/'].map(branch => ({ VERCEL_GIT_COMMIT_REF: branch })), ...['prod:wary-toad-189|secret', 'preview:instance-name|secret', 'project:team:project|secret', 'personal-token'].map(key => ({ CONVEX_DEPLOY_KEY: key })), ...['CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_OVERRIDE_ACCESS_TOKEN', 'CONVEX_OVERRIDE_DEPLOYMENT_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'].map(key => ({ [key]: 'conflict' }))]) expect(() => previewConfiguration({ ...env, ...mutation })).toThrow();
  });
  it('refuses production, shared dev and misleading URL forms', () => {
    for (const url of ['https://wary-toad-189.convex.cloud', 'https://optimistic-turtle-573.convex.cloud', 'http://preview-example-123.convex.cloud', 'https://preview-example-123.convex.cloud.evil.test', 'https://preview-example-123.convex.cloud/path', 'https://user@preview-example-123.convex.cloud', 'https://preview-example-123.convex.cloud?other=1']) expect(() => previewUrl(url)).toThrow();
    expect(previewDashboardTarget('https://dashboard.convex.dev/d/preview-example-123')).toBe('https://preview-example-123.convex.cloud');
    for (const url of ['https://dashboard.convex.dev/d/wary-toad-189', 'https://dashboard.convex.dev/d/optimistic-turtle-573', 'http://dashboard.convex.dev/d/preview-example-123', 'https://dashboard.convex.dev.evil.test/d/preview-example-123', 'https://dashboard.convex.dev/d/preview-example-123?token=bad', 'https://user@dashboard.convex.dev/d/preview-example-123', 'https://dashboard.convex.dev/d/preview-example-123/settings']) expect(() => previewDashboardTarget(url)).toThrow();
  });
  it('deploys and authorizes the branch then seeds before Next builds, retaining rebuild state', async () => {
    const calls: string[] = [];
    const url = 'https://preview-example-123.convex.cloud';
    const steps = { deploy: async () => { calls.push('deploy'); return url; }, resolve: async () => { calls.push('authorize'); return url; }, seed: async () => { calls.push('seed'); }, build: async (target: string) => { expect(target).toBe(url); calls.push('next'); } };
    expect(await buildSeededPreview(steps)).toBe('seeded');
    expect(calls).toEqual(['deploy', 'authorize', 'seed', 'next']);
    expect(await buildSeededPreview({ ...steps, seed: async () => { throw new Error('Seed requires an empty database; orders is not empty'); } })).toBe('preserved');
    for (const failure of ['deploy', 'resolve', 'seed']) {
      calls.length = 0;
      await expect(buildSeededPreview({ ...steps, [failure]: async () => { throw new Error('injected failure'); } })).rejects.toThrow('injected failure');
      expect(calls).not.toContain('next');
    }
    calls.length = 0;
    await expect(buildSeededPreview({ ...steps, resolve: async () => 'https://different-preview-123.convex.cloud' })).rejects.toThrow('differs');
    expect(calls).toEqual(['deploy']);
  });
});

it('Vitest projects partition all former defaults once, preserving DOM harness and pure backend leaves', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const projects = testProjects(root);
  const expected = (await Promise.all(['tests/unit', 'convex'].map(async dir => (await fs.readdir(path.join(root, dir), { recursive: true })).filter(file => file.endsWith('.test.ts')).map(file => `${dir}/${file}`)))).flat();
  expect(Object.values(projects).flat().sort()).toEqual(expected.sort());
  expect(new Set(Object.values(projects).flat()).size).toBe(expected.length);
  expect(projects.dom).toContain('tests/unit/pos-order-recovery.test.ts');
  expect(projects.convex).toContain('convex/adminChat.test.ts');
  expect(projects.unit).toContain('convex/shared/offers.test.ts');
  expect(projects.unit).toContain('tests/unit/eslint-guardrails.test.ts');
  expect(projects.unit).toContain('tests/unit/convex-schema-tools.test.ts');
  expect(projects.dom.every(file => file.startsWith('tests/unit/'))).toBe(true);
});
