// The Clerk rule of scripts/shared-runtimes.mjs, kept for the Clerk pin's guard test.
import { SHARED_RUNTIMES, sharedRuntime } from './shared-runtimes.mjs';

export { resolvePackageDir } from './shared-runtimes.mjs';

const clerk = SHARED_RUNTIMES.find(rule => rule.shared === '@clerk/shared');

/** @param {string} root */
export const clerkRuntime = root => sharedRuntime(root, /** @type {NonNullable<typeof clerk>} */ (clerk));
