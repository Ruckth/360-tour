import type { MutationCtx } from '../_generated/server';
import type { Id, TableNames } from '../_generated/dataModel';
import schema from '../schema';
import { seedProperties } from './seeds/properties';
import { seedRooms } from './seeds/rooms';
import { seedReviews } from './seeds/reviews';
import { seedTourSnippets } from './seeds/tourSnippets';
import { seedStaffServicesData } from './seeds/staffServices';
import { recomputeSocialProof } from '../catalog/model';
import { createBookingRecord, recordStayPayment, blockBookingDates, writeBooking } from '../bookings/model';



import { insertOrder } from '../pos/model';
import { createGuestToken, hashGuestToken } from '../messaging/model';
import { DEFAULT_CASHIER_RULES } from '../lib/staffTypes';

export type ScenarioName = 'empty' | 'demo-resort' | 'busy-weekend';
const tables = Object.keys(schema.tables) as TableNames[];
export async function scenarioCounts(ctx: MutationCtx) {
  const counts = {} as Record<TableNames, number>;
  for (const table of tables) {
    let count = 0;
    for await (const _row of ctx.db.query(table)) { void _row; count++; }
    counts[table] = count;
  }
  return counts;
}
/** Atomic, bounded sample data. Refuses any nonempty database; it never clears or partially repairs one. */
export async function seedScenario(ctx: MutationCtx, name: ScenarioName) {
  for (const table of tables) if (await ctx.db.query(table).first()) throw new Error(`Seed requires an empty database; ${table} is not empty`);
  if (name === 'empty') return { scenario: name, counts: await scenarioCounts(ctx), bookings: [], conversation: null };
  const now = Date.now();
  const properties = await seedProperties(ctx);
  await seedRooms(ctx, properties);
  await seedReviews(ctx, properties);
  await seedTourSnippets(ctx, properties);
  for (const propertyId of Object.values(properties)) await recomputeSocialProof(ctx, propertyId);
  await seedStaffServicesData(ctx);
  const { revision, ...rules } = DEFAULT_CASHIER_RULES;
  await ctx.db.insert('cashierRules', { key: 'default', ...rules, revision, updatedAt: now, updatedByEmail: 'system:seed' });
  await ctx.db.insert('siteSettings', { key: 'default', revision: 0, businessName: 'Auralis Cove Retreat', updatedAt: now, updatedByEmail: 'system:seed' });
  await ctx.db.insert('businessFacts', { title: 'Demo resort', body: 'This is a preview resort. Ask staff to verify special requests.', searchText: 'demo preview resort staff special requests', source: 'Seed scenario', status: 'approved', revision: 1, createdAt: now, updatedAt: now, createdByAdminEmail: 'system:seed', updatedByAdminEmail: 'system:seed' });
  const bookings: Array<{ bookingId: Id<'bookings'>; accessToken: string }> = [];
  const slugs = ['pool-villa', 'garden-suite', 'penthouse'];
  for (let i = 0; i < (name === 'busy-weekend' ? 6 : 2); i++) {
    const inAt = now + (7 + Math.floor(i / 3) * 7) * 86400000;
    const stay = await createBookingRecord(ctx, { propertySlug: slugs[i % 3], checkIn: new Date(inAt).toISOString().slice(0, 10), checkOut: new Date(inAt + 2 * 86400000).toISOString().slice(0, 10), guests: 2, guestName: `Scenario guest ${i + 1}`, guestPhone: `+6681000200${i}`, guestEmail: `guest${i + 1}@example.test`, source: 'admin', actor: 'system:seed', guestEmailsOff: true });
    if (i === 0) await recordStayPayment(ctx, stay.bookingId, { origin: 'manual', method: 'cash', actor: 'system:seed', paymentLabel: 'admin', notifyGuest: false, idempotencyKey: `seed-payment-${i}` });
    else {
      const booking = (await ctx.db.get(stay.bookingId))!;
      await blockBookingDates(ctx, booking, stay.bookingId);
      await writeBooking(ctx, booking, { status: 'confirmed' }, { actor: 'system:seed', kind: 'confirmed' });
    }
    bookings.push(stay);
  }
  const order = await insertOrder(ctx, 'system:seed');
  await ctx.db.insert('orderLines', { orderId: order._id, kind: 'extra', name: 'Welcome refreshments', unitPrice: 15000, catalogUnitPrice: 15000, currency: 'THB', qty: 1, createdAt: now });
  await ctx.db.patch(order._id, { total: 15000, due: 15000, itemCount: 1, hasItems: true });
  const guestToken = createGuestToken();
  const sessionId = await ctx.db.insert('conversations', { channel: 'web', visitorId: 'scenario:inbox', visitorName: 'Scenario guest', guestTokenHash: await hashGuestToken(guestToken), currentPath: '/chat', lastSeenAt: now, lastOpenedAt: now, messageCount: 1, latestMessageAt: now, adminSortAt: now, adminSearchText: 'scenario guest airport arrival', aiPaused: true, adminStatus: 'open', inboxState: 'needs_staff', inboxReason: 'handoff', inboxHandoff: true, createdAt: now });
  const messageId = await ctx.db.insert('messages', { sessionId, role: 'user', content: 'Could staff help arrange our airport arrival?', timestamp: now });
  await ctx.db.patch(sessionId, { latestGuestMessageId: messageId });
  return { scenario: name, counts: await scenarioCounts(ctx), bookings, openOrderId: order._id, conversation: { sessionId, guestToken } };
}
