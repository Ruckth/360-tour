import { internal } from '../../_generated/api';
import type { ActionCtx, MutationCtx } from '../../_generated/server';

const RETRY_DELAYS = [1_000, 5_000, 15_000];
const DELIVER_TIMEOUT_MS = 2_500;

function deliveryConfig() {
  const origin = process.env.START_VILLA_INVALIDATION_ORIGIN;
  const secret = process.env.START_VILLA_INVALIDATION_SECRET;
  if (!origin || !secret || !/^[a-zA-Z0-9_-]{32,}$/.test(secret)) return null;
  try {
    const url = new URL(origin);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if ((!loopback && url.protocol !== 'https:') ||
        (loopback && url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    // The configured exact app origin is the only destination. Mutation arguments
    // never influence the protocol, host or route, and redirects are disabled.
    return {
      endpoint: new URL('/api/internal/villa-cache', url).href,
      secret,
      bypass: process.env.START_VILLA_INVALIDATION_BYPASS_TOKEN,
    };
  } catch {
    return null;
  }
}

export function villaInvalidationEnabled() {
  return deliveryConfig() !== null;
}

export async function scheduleVillaInvalidation(ctx: MutationCtx, ...slugs: string[]) {
  if (!villaInvalidationEnabled()) return;
  await ctx.scheduler.runAfter(0, internal.catalog.properties.deliverVillaInvalidation, {
    slugs: [...new Set(slugs)],
    attempt: 0,
  });
}

export async function deliverVillaCacheInvalidation(
  ctx: ActionCtx,
  { slugs, attempt }: { slugs: string[]; attempt: number },
): Promise<void> {
  const config = deliveryConfig();
  if (!config) return;
  try {
    const headers: Record<string, string> = {
      authorization: 'Bearer ' + config.secret,
      'content-type': 'application/json',
    };
    if (config.bypass) headers['x-vercel-protection-bypass'] = config.bypass;
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slugs }),
      redirect: 'error',
      signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
    });
    if (response.status === 204) return;
    if (response.status < 500 && response.status !== 408 && response.status !== 429) {
      console.warn('Villa cache invalidation was rejected');
      return;
    }
  } catch {
    // Unavailable app or network. The detail cache also has a short TTL.
  }
  if (attempt >= RETRY_DELAYS.length) {
    console.warn('Villa cache invalidation exhausted retries');
    return;
  }
  await ctx.scheduler.runAfter(RETRY_DELAYS[attempt], internal.catalog.properties.deliverVillaInvalidation, {
    slugs,
    attempt: attempt + 1,
  });
}
