import { seedEmpty } from './seed-empty.mjs';
import { disabledServiceKeys, disabledServices } from './local-integration-config.mjs';

/** Installed `convex env list` prints NAME=value, quoting nonempty multiline values.
 * Empty values alone are safe. Never include provider values in an error or log.
 * @param {string} listing
 */
export function assertPreviewProvidersDisabled(listing) {
  const forbidden = disabledServiceKeys.filter(name =>
    new RegExp(`^${name}=.+`, 'm').test(listing));
  if (forbidden.length) throw new Error(`Disable Preview provider variables before pushing: ${forbidden.join(', ')}`);
}

/** Pin disabled values so Next cannot restore business credentials from dotenv.
 * @param {NodeJS.ProcessEnv} env @param {string} url
 */
export function previewFrontendEnvironment(env, url) {
  const siteUrl = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '';
  return { ...env, ...disabledServices, NEXT_PUBLIC_CONVEX_URL: previewUrl(url), NEXT_PUBLIC_CONVEX_SITE_URL: url.replace('.convex.cloud', '.convex.site'), SITE_URL: siteUrl, NEXT_PUBLIC_SITE_URL: siteUrl };
}

export const protectedDeployments = ['wary-toad-189', 'optimistic-turtle-573'];
/** @param {Record<string, string | undefined>} env */
export function previewConfiguration(env) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_REPO_OWNER !== 'Ruckth' || env.VERCEL_GIT_REPO_SLUG !== '360-tour') throw new Error('Preview build requires the Ruckth/360-tour Vercel Git Preview environment');
  const match = /^preview:([a-z0-9-]+):([a-z0-9-]+)\|([^\s|]+)$/.exec(env.CONVEX_DEPLOY_KEY || '');
  if (!match || !env.CONVEX_PREVIEW_TEAM || !env.CONVEX_PREVIEW_PROJECT || match[1] !== env.CONVEX_PREVIEW_TEAM || match[2] !== env.CONVEX_PREVIEW_PROJECT) throw new Error('Use the matching project-scoped Preview Deploy Key and explicit CONVEX_PREVIEW_TEAM/CONVEX_PREVIEW_PROJECT; personal, project-admin and deployment keys are refused');
  const branch = env.VERCEL_GIT_COMMIT_REF;
  const defaultBranch = env.CONVEX_PREVIEW_DEFAULT_BRANCH;
  if (!defaultBranch || !branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || [defaultBranch, 'main', 'master', 'default', 'production', 'prod', 'dev'].includes(branch) || branch.includes('..') || branch.endsWith('/')) throw new Error('Preview requires a non-default Git branch and CONVEX_PREVIEW_DEFAULT_BRANCH');
  for (const key of ['CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_OVERRIDE_ACCESS_TOKEN', 'CONVEX_OVERRIDE_DEPLOYMENT_URL']) if (env[key]) throw new Error(`Preview refuses conflicting ${key}`);
  return { branch, team: match[1], project: match[2] };
}

/** @param {string} url */
export function previewUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/^[a-z0-9]+(?:-[a-z0-9]+)+\.convex\.cloud$/.test(parsed.hostname) || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || protectedDeployments.some(name => parsed.hostname === `${name}.convex.cloud`)) throw new Error('Refusing shared, production or noncanonical Preview URL');
  return parsed.origin;
}

/** dashboard --no-open uses the branch-authorized deployment's metadata, not a system RPC.
 * @param {string} dashboard
 */
export function previewDashboardTarget(dashboard) {
  const parsed = new URL(dashboard);
  const match = /^\/d\/([a-z0-9]+(?:-[a-z0-9]+)+)$/.exec(parsed.pathname);
  if (parsed.origin !== 'https://dashboard.convex.dev' || parsed.username || parsed.password || parsed.search || parsed.hash || !match) throw new Error('Invalid branch-authorized Preview dashboard identity');
  return previewUrl(`https://${match[1]}.convex.cloud`);
}

/** All callers cross this ordering seam; no frontend build can precede backend/seed success.
 * @param {{deploy: () => Promise<string>, resolve: () => Promise<string>, seed: () => Promise<unknown>, build: (url: string) => Promise<void>}} steps
 */
export async function buildSeededPreview(steps) {
  const url = previewUrl(await steps.deploy());
  // --preview-name uses CLI authorize_preview, scoped by the project Preview key.
  if (previewUrl(await steps.resolve()) !== url) throw new Error('Deployed URL differs from project/branch-authorized preview');
  const state = await seedEmpty(steps.seed);
  await steps.build(url);
  return state;
}
