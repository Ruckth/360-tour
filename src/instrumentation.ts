import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    if (process.env.VERCEL_ENV === 'preview' && process.env.VILLA_BENCH_NAMESPACE === '1') {
      const { installNextVillaBenchmarkHook } = await import('./lib/server/next-villa-benchmark');
      installNextVillaBenchmarkHook();
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}

export const onRequestError = Sentry.captureRequestError;
