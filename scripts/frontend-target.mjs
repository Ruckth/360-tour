import { DUAL_ENTRY_CHECKPOINT_SHA } from './dual-entry-checkpoint.mjs';
import { previewUrl } from './preview-build.mjs';

/** The production backend; a frontend-only production build may target only this URL. */
export const productionConvexUrl = 'https://wary-toad-189.convex.cloud';

/**
 * The frontend a Vercel build ships, and whether it skips the Convex deploy. TanStack Start is
 * the only entry; the retired Next entry is rebuilt only from the accepted dual-entry checkpoint or an
 * older revision (Phase 4 cutover runbook §7), whose own selector and scripts build it.
 * `FRONTEND_ONLY_CONVEX_URL` builds against an existing, already deployed backend (staged
 * rollout): no `convex deploy`, no seed. Preview may only target a preview backend.
 * @param {Record<string, string | undefined>} env
 * @returns {{ frontend: 'start', script: 'build', urlEnv: 'VITE_CONVEX_URL', frontendOnlyUrl?: string }}
 */
export function frontendTarget(env) {
  const choice = env.FRONTEND || 'start';
  if (choice === 'next') throw new Error(`FRONTEND=next: the Next entry was retired. Roll back (Instant Rollback or alias) to the verified Stage 0 Next deployment, or deploy dual-entry checkpoint ${DUAL_ENTRY_CHECKPOINT_SHA} with its own FRONTEND=next vercel-build plus "framework": "nextjs" in its vercel.json (Phase 4 cutover runbook §7)`);
  if (choice !== 'start') throw new Error('FRONTEND must be "start" (or unset)');
  const target = { frontend: /** @type {const} */ ('start'), script: /** @type {const} */ ('build'), urlEnv: /** @type {const} */ ('VITE_CONVEX_URL') };
  const requested = env.FRONTEND_ONLY_CONVEX_URL;
  if (!requested) return target;
  if (env.VERCEL_ENV !== 'production') return { ...target, frontendOnlyUrl: previewUrl(requested) };
  if (requested.replace(/\/$/, '') !== productionConvexUrl) throw new Error('A frontend-only production build must target the production backend URL exactly');
  return { ...target, frontendOnlyUrl: productionConvexUrl };
}

/** Production frontend environment for an existing backend (both env spellings; Vite maps NEXT_PUBLIC_*).
 * @param {NodeJS.ProcessEnv} env @param {string} url
 */
export function frontendOnlyEnvironment(env, url) {
  const site = url.replace('.convex.cloud', '.convex.site');
  return {
    ...env,
    NEXT_PUBLIC_CONVEX_URL: url, VITE_CONVEX_URL: url,
    NEXT_PUBLIC_CONVEX_SITE_URL: site, VITE_CONVEX_SITE_URL: site,
  };
}
