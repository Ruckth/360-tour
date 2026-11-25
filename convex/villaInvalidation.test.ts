// @vitest-environment edge-runtime

import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const secret = 'isolated-test-villa-cache-signing-secret';
const origin = 'https://fixture-start.vercel.app';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function setup() {
  vi.useFakeTimers();
  vi.stubEnv('START_VILLA_INVALIDATION_ORIGIN', '');
  vi.stubEnv('START_VILLA_INVALIDATION_SECRET', '');
  const t = convexTest(schema, modules);
  const admin = await asTestOwner(t, { email: 'villa-cache-admin@example.com', emailVerified: true });
  const propertyId = await admin.mutation(api.catalog.adminProperties.create, { name: 'Old Villa' });
  await admin.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 15_000, status: 'active' });
  return { t, admin, propertyId };
}

it('delivers both slugs for committed renames and retries temporary delivery failures', async () => {
  const { t, admin, propertyId } = await setup();
  vi.stubEnv('START_VILLA_INVALIDATION_ORIGIN', origin);
  vi.stubEnv('START_VILLA_INVALIDATION_SECRET', secret);
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await admin.mutation(api.catalog.adminProperties.setSlug, { propertyId, slug: 'new-villa' });
  await expect(t.query(api.catalog.publicProperties.getBySlug, { slug: 'old-villa' })).resolves.toBeNull();
  await expect(t.query(api.catalog.publicProperties.getBySlug, { slug: 'new-villa' }))
    .resolves.toMatchObject({ villa: { slug: 'new-villa' } });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [target, options] of fetcher.mock.calls) {
    expect(target).toBe(origin + '/api/internal/villa-cache');
    expect(options).toMatchObject({
      method: 'POST', redirect: 'error', body: '{"slugs":["old-villa","new-villa"]}',
      headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    });
  }
});

it('invalidates an active villa after review create, update and removal', async () => {
  const { t, admin, propertyId } = await setup();
  vi.stubEnv('START_VILLA_INVALIDATION_ORIGIN', origin);
  vi.stubEnv('START_VILLA_INVALIDATION_SECRET', secret);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const review = {
    authorName: 'Guest', authorCity: '', authorCountry: '', rating: 4, title: 'Stay',
    body: 'Review text', date: '2026-11-21', verified: true,
  };
  const reviewId = await admin.mutation(api.catalog.adminReviews.create, { propertyId, ...review });
  await admin.mutation(api.catalog.adminReviews.update, { reviewId, ...review, rating: 5 });
  await admin.mutation(api.catalog.adminReviews.remove, { reviewId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetcher.mock.calls.map(([, options]) => options?.body)).toEqual(
    Array.from({ length: 3 }, () => '{"slugs":["old-villa"]}'),
  );
});
