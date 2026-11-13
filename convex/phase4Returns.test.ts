// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import type { ValidatorJSON } from 'convex/values';
import { expect, it } from 'vitest';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const contracts = [
  [
    "services/publicServices",
    "categories",
    "query"
  ],
  [
    "services/publicServices",
    "list",
    "query"
  ],
  [
    "services/publicServices",
    "getBySlug",
    "query"
  ],
  [
    "messaging/chatSuggestions",
    "nextForSession",
    "query"
  ],
  [
    "messaging/chatSuggestions",
    "markShown",
    "mutation"
  ],
  [
    "messaging/chatSuggestions",
    "markClicked",
    "mutation"
  ],
  [
    "messaging/chat",
    "createSession",
    "mutation"
  ],
  [
    "messaging/chat",
    "touchSession",
    "mutation"
  ],
  [
    "messaging/chat",
    "closeSession",
    "mutation"
  ],
  [
    "messaging/chat",
    "createBrowserHandoff",
    "mutation"
  ],
  [
    "messaging/chat",
    "claimBrowserHandoff",
    "mutation"
  ],
  [
    "messaging/chat",
    "identifyVisitor",
    "mutation"
  ],
  [
    "messaging/chat",
    "getSession",
    "query"
  ],
  [
    "messaging/chat",
    "isAiPaused",
    "query"
  ],
  [
    "messaging/chat",
    "getMessages",
    "query"
  ],
  [
    "messaging/chat",
    "sendMessage",
    "mutation"
  ],
  [
    "messaging/leads",
    "save",
    "mutation"
  ],
  [
    "marketing/public",
    "resolveLink",
    "query"
  ],
  [
    "marketing/public",
    "recordOpen",
    "mutation"
  ],
  [
    "marketing/public",
    "startSession",
    "mutation"
  ],
  [
    "marketing/public",
    "previewCoupon",
    "query"
  ],
  [
    "marketing/access",
    "current",
    "query"
  ],
  [
    "marketing/report",
    "noteCouponRefusal",
    "mutation"
  ],
  [
    "auth/users",
    "current",
    "query"
  ],
  [
    "auth/staffAccess",
    "myAccess",
    "query"
  ],
  [
    "bookings/bookings",
    "quoteStay",
    "query"
  ],
  [
    "bookings/bookings",
    "create",
    "mutation"
  ],
  [
    "bookings/bookings",
    "getById",
    "query"
  ],
  [
    "bookings/bookings",
    "getConfirmProposal",
    "query"
  ],
  [
    "bookings/bookings",
    "confirmProposal",
    "mutation"
  ],
  [
    "pos/displays",
    "claimLink",
    "mutation"
  ],
  [
    "pos/displays",
    "startPairing",
    "mutation"
  ],
  [
    "pos/displays",
    "releaseDisplay",
    "mutation"
  ],
  [
    "pos/displays",
    "current",
    "query"
  ],
  [
    "pos/displays",
    "heartbeat",
    "mutation"
  ],
  [
    "bookings/calendar/availability",
    "getForProperty",
    "query"
  ],
  [
    "bookings/calendar/availability",
    "getBlockedDates",
    "query"
  ],
  [
    "bookings/calendar/availability",
    "getBlockedDatesByProperty",
    "query"
  ],
  [
    "bookings/calendar/availability",
    "isAvailable",
    "query"
  ],
  [
    "bookings/payments/stripe",
    "createCheckout",
    "action"
  ],
  [
    "settings/settings",
    "publicProfile",
    "query"
  ],
  [
    "catalog/properties",
    "list",
    "query"
  ],
  [
    "catalog/properties",
    "getBySlug",
    "query"
  ],
  [
    "catalog/properties",
    "getById",
    "query"
  ],
  [
    "catalog/properties",
    "getRooms",
    "query"
  ],
  [
    "catalog/properties",
    "getTourRooms",
    "query"
  ],
  [
    "catalog/properties",
    "getOtaComparison",
    "query"
  ],
  [
    "catalog/properties",
    "getSocialProof",
    "query"
  ],
  [
    "catalog/properties",
    "getReviews",
    "query"
  ],
  [
    "catalog/properties",
    "getTourSnippets",
    "query"
  ],
  [
    "catalog/publicProperties",
    "list",
    "query"
  ],
  [
    "catalog/publicProperties",
    "getBySlug",
    "query"
  ],
  [
    "catalog/publicProperties",
    "featuredReviews",
    "query"
  ]
] as const;

function sample(validator: ValidatorJSON): unknown {
  switch (validator.type) {
    case 'null': return null;
    case 'string': return 'contract-test';
        case 'boolean': return false;
    case 'bigint': return 1n;
    case 'any': return null;
    case 'number': return 1;
    case 'bytes': return new ArrayBuffer(0);
    case 'literal': return validator.value;
    case 'id': return '1' + validator.tableName;
    case 'array': return [];
    case 'record': return {};
    case 'union': return sample(validator.value[0]);
    case 'object': return Object.fromEntries(Object.entries(validator.value).filter(([, field]) => !field.optional).map(([key, field]) => [key, sample(field.fieldType)]));
    default: throw new Error('Unbounded argument contract');
  }
}

// Fault injection replaces only the registered handler, leaving convex-test's actual argument
// and return validation active. Successful/auth/refusal paths remain covered by domain suites.
it.each(contracts)('enforces the runtime return contract for %s:%s (%s)', async (path, name, kind) => {
  const loaded = await modules['./' + path + '.ts']();
  const fn = Reflect.get(Object(loaded), name);
  const original = Reflect.get(fn, '_handler');
  const args = sample(JSON.parse(fn.exportArgs()));
  expect(JSON.parse(fn.exportReturns())).not.toBeNull();
  // convex-test 0.0.53 omits record validation; its real-backend fault probe is recorded separately.
  if (path.endsWith('availability') && name === 'getBlockedDatesByProperty') {
    expect(JSON.parse(fn.exportReturns())).toMatchObject({ type: 'record', values: { fieldType: { type: 'array', value: { type: 'string' } } } });
    return;
  }
  Reflect.set(fn, '_handler', async () => 1234567);
  try {
    const t = convexTest(schema, modules);
    const values = args as Record<string, unknown>;
    const result = kind === 'query' ? t.query(makeFunctionReference<'query'>(path + ':' + name), values) : kind === 'mutation' ? t.mutation(makeFunctionReference<'mutation'>(path + ':' + name), values) : t.action(makeFunctionReference<'action'>(path + ':' + name), values);
    await expect(result).rejects.toThrow(/return.*valid|return value/i);
  } finally { Reflect.set(fn, '_handler', original); }
});

it('preserves active-villa projections, optional copy, private-token omission and refused draft lookups', async () => {
  const t = convexTest(schema, modules);
  const propertyId = await t.run(ctx => ctx.db.insert('properties', { slug: 'contract-villa', name: 'Villa', tagline: '', description: '', pricePerNight: 10050, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 20, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 1000, status: 'active', icalExportToken: 'private-test-only' }));
  const byId = makeFunctionReference<'query'>('catalog/properties:getById'), bySlug = makeFunctionReference<'query'>('catalog/properties:getBySlug');
  const found = await t.query(byId, { id: propertyId });
  expect(found).toMatchObject({ _id: propertyId, pricePerNight: 10050, directDiscountPercent: 1000 });
  expect(found).not.toHaveProperty('icalExportToken');
  expect(found).not.toHaveProperty('translations');
  expect(await t.query(bySlug, { slug: 'contract-villa' })).toEqual(found);
  expect(await t.query(makeFunctionReference<'query'>('catalog/properties:getTourSnippets'), { propertyId })).toEqual([]);
  const loaded = await modules['./catalog/properties.ts']();
  const fn = Reflect.get(Object(loaded), 'getById'), original = Reflect.get(fn, '_handler');
  Reflect.set(fn, '_handler', async (...args: unknown[]) => {
    const response: unknown = await Reflect.apply(original, fn, args);
    if (!response || typeof response !== 'object') throw new Error('Expected an active villa');
    return { ...response, icalExportToken: 'private-test-only' };
  });
  try { await expect(t.query(byId, { id: propertyId })).rejects.toThrow(/Return value validation failed/); }
  finally { Reflect.set(fn, '_handler', original); }
  await t.run(ctx => ctx.db.patch(propertyId, { status: 'draft' }));
  expect(await t.query(byId, { id: propertyId })).toBeNull();
  expect(await t.query(bySlug, { slug: 'contract-villa' })).toBeNull();
});
