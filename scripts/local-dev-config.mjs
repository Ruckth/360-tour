import fs from 'node:fs/promises';
import path from 'node:path';
import { disabledServices } from './local-integration-config.mjs';

export const clerkFields = ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_ISSUER_DOMAIN'];
const fields = [...clerkFields, 'LOCAL_DEV_OWNER_EMAILS', 'LOCAL_DEV_PORT'];

/** Parse comma-separated LOCAL_DEV_OWNER_EMAILS, ignoring blank entries (such as a trailing comma).
 * @param {string | undefined} raw
 */
export function parseDevOwnerEmails(raw) {
  return (raw ?? '').split(',').map(email => email.trim()).filter(Boolean);
}

/** Read only this explicit, private configuration, never the project's ordinary dotenv files.
 * @param {string} file
 */
export async function readDevConfig(file) {
  const stat = await fs.lstat(file).catch(() => { throw new Error('Create mode-600 .env.dev.local; see docs/architecture/phase3f-operations.md'); });
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('.env.dev.local must be a regular mode-600 file');
  /** @type {Record<string, string>} */
  const config = {};
  for (const line of (await fs.readFile(file, 'utf8')).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match || !fields.includes(match[1]) || match[1] in config) throw new Error('Unknown or duplicate .env.dev.local field; only Clerk, LOCAL_DEV_OWNER_EMAILS and LOCAL_DEV_PORT are allowed');
    config[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!config.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_') || !config.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Local development requires real Clerk test-tenant keys');
  const host = Buffer.from(config.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice(8), 'base64').toString().replace(/\$$/, '');
  let issuer;
  try { issuer = new URL(config.CLERK_JWT_ISSUER_DOMAIN); }
  catch { throw new Error('Set CLERK_JWT_ISSUER_DOMAIN to the matching real HTTPS Clerk test issuer'); }
  if (issuer.protocol !== 'https:' || issuer.host !== host || issuer.pathname !== '/' || issuer.search || issuer.hash) throw new Error('Clerk issuer must match the publishable test key');
  const ownerEmails = parseDevOwnerEmails(config.LOCAL_DEV_OWNER_EMAILS);
  if (!ownerEmails.length || !ownerEmails.every(email => /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email))) throw new Error('Set LOCAL_DEV_OWNER_EMAILS explicitly to your local Clerk test owners');
  if (config.LOCAL_DEV_PORT && !/^[1-9]\d{3,4}$/.test(config.LOCAL_DEV_PORT)) throw new Error('LOCAL_DEV_PORT must be a port between 1024 and 65535');
  const port = Number(config.LOCAL_DEV_PORT || 3000);
  if (port < 1024 || port > 65535) throw new Error('LOCAL_DEV_PORT must be a port between 1024 and 65535');
  return { ...config, port };
}

/** @param {Record<string, string | undefined>} supplied */
export function refuseInheritedTarget(supplied) {
  for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_OVERRIDE_ACCESS_TOKEN', 'CONVEX_OVERRIDE_DEPLOYMENT_URL']) {
    if (supplied[key]) throw new Error(`Unset inherited ${key} before bun run dev; this command owns only a checkout-local anonymous backend`);
  }
  for (const key of ['NEXT_PUBLIC_CONVEX_URL', 'PUBLIC_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_SITE_URL', 'VITE_CONVEX_URL', 'VITE_CONVEX_SITE_URL']) {
    if (supplied[key]) throw new Error(`Unset inherited ${key}; bun run dev chooses its own local target`);
  }
}

/** @param {{deploymentName?: string, adminKey?: string, ports?: {cloud: number, site: number}}} config @param {{cloud: number, site: number}} ports */
export function requireAnonymousState(config, ports) {
  if (!/^anonymous-[A-Za-z0-9_-]+$/.test(config.deploymentName || '') || !config.adminKey || config.ports?.cloud !== ports.cloud || config.ports?.site !== ports.site) throw new Error('Invalid isolated anonymous backend config; refusing another target');
}

/** @param {Record<string, string | undefined>} supplied @param {string} home @param {Record<string, string | number>} config */
export function devEnvironment(supplied, home, config) {
  return {
    ...disabledServices,
    PATH: supplied.PATH,
    HOME: home,
    LANG: 'en_US.UTF-8',
    CONVEX_AGENT_MODE: 'anonymous',
    CONVEX_TELEMETRY_DISABLED: '1',
    ...Object.fromEntries(clerkFields.map(key => [key, String(config[key])])),
    CLERK_PUBLISHABLE_KEY: String(config.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  };
}

/** Public values the Start dev server substitutes for SSR and the browser, in both spellings. They are set
 * explicitly because the Vite config prefers `VITE_*` over `NEXT_PUBLIC_*`: the disabled-service blanks and any
 * checkout dotenv `VITE_*` key would otherwise win over this checkout's validated loopback and test-tenant values.
 * @param {{ convexUrl: string, siteUrl: string, appUrl: string, publishableKey: string }} values
 */
export function devPublicEnvironment({ convexUrl, siteUrl, appUrl, publishableKey }) {
  return {
    NEXT_PUBLIC_CONVEX_URL: convexUrl, VITE_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: siteUrl, VITE_CONVEX_SITE_URL: siteUrl,
    SITE_URL: appUrl, NEXT_PUBLIC_SITE_URL: appUrl, VITE_SITE_URL: appUrl,
    VITE_CLERK_PUBLISHABLE_KEY: publishableKey,
  };
}

/** `bun run dev` serves TanStack Start. No reset, remote-target or framework options exist.
 * @param {string[]} args
 */
export function checkDevArgs(args) {
  if (args.includes('--next')) throw new Error('bun run dev -- --next was removed with the Next entry; run it from the dual-entry checkpoint checkout');
  if (args.length) throw new Error('bun run dev takes no arguments; configure .env.dev.local instead');
}

/** Node arguments for the Start dev server on the checkout's own port.
 * @param {string} root @param {number} port
 */
export function devFrontendCommand(root, port) {
  return [path.join(root, 'node_modules/vite/bin/vite.js'), 'dev', '--config', 'vite.start.config.ts', '--host', 'localhost', '--port', String(port), '--strictPort'];
}
