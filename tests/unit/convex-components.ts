import { vi } from 'vitest';
import rateLimiter from '@convex-dev/rate-limiter/test';
/** Register real component schemas/functions in every isolated Convex test database. */
vi.mock('convex-test', async importOriginal => {
  const original = await importOriginal<typeof import('convex-test')>();
  return { ...original, convexTest: (...args: Parameters<typeof original.convexTest>) => {
    const t = original.convexTest(...args);
    rateLimiter.register(t);
    return t;
  } };
});
