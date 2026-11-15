import fs from 'node:fs/promises';
import { disabledServices } from './local-integration-config.mjs';

export const clerkFields = ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_ISSUER_DOMAIN'];
const fields = [...clerkFields, 'LOCAL_DEV_OWNER_EMAILS', 'LOCAL_DEV_PORT'];
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
  if (!config.LOCAL_DEV_OWNER_EMAILS || !config.LOCAL_DEV_OWNER_EMAILS.split(',').every(email => /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email.trim()))) throw new Error('Set LOCAL_DEV_OWNER_EMAILS explicitly to your local Clerk test owners');
  if (config.LOCAL_DEV_PORT && !/^[1-9]\d{3,4}$/.test(config.LOCAL_DEV_PORT)) throw new Error('LOCAL_DEV_PORT must be a port between 1024 and 65535');
  const port = Number(config.LOCAL_DEV_PORT || 3000);
  if (port < 1024 || port > 65535) throw new Error('LOCAL_DEV_PORT must be a port between 1024 and 65535');
  return { ...config, port };
}

/** @param {Record<string, string | undefined>} supplied */
export function refuseInheritedTarget(supplied) {
  for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_OVERRIDE_ACCESS_TOKEN', 'CONVEX_OVERRIDE_DEPLOYMENT_URL']) {
    if (supplied[key]) throw new Error(`Unset inherited ${key} before pnpm dev; this command owns only a checkout-local anonymous backend`);
  }
  for (const key of ['NEXT_PUBLIC_CONVEX_URL', 'PUBLIC_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_SITE_URL']) {
    if (supplied[key]) throw new Error(`Unset inherited ${key}; pnpm dev chooses its own local target`);
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
    NEXT_TELEMETRY_DISABLED: '1',
    ...Object.fromEntries(clerkFields.map(key => [key, String(config[key])])),
    CLERK_PUBLISHABLE_KEY: String(config.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  };
}
