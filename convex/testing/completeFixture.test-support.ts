import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { WithoutSystemFields } from 'convex/server';
import { nextCounter } from '../pos/model';

type Tables = 'bookings' | 'appointments' | 'orders' | 'orderLines';
type Defaults<T extends Tables> = T extends 'bookings' ? 'amountPaid' | 'amountRefunded' | 'guestPhoneDigits'
  : T extends 'appointments' ? 'amountPaid' | 'amountRefunded' | 'guestPhoneDigits' | 'serviceNameSnapshot' | 'staffNameSnapshot'
  : T extends 'orders' ? 'orderNumber' | 'due' : 'catalogUnitPrice';
type Fixture<T extends Tables> = Omit<WithoutSystemFields<Doc<T>>, Defaults<T>> & Partial<Pick<WithoutSystemFields<Doc<T>>, Extract<Defaults<T>, keyof WithoutSystemFields<Doc<T>>>>>;
/** Test fixtures are complete new-schema records. Conditional fields follow the explicit fixture status. */
export async function insertFixture<T extends Tables>(ctx: MutationCtx, table: T, data: Fixture<T>): Promise<Id<T>> {
  // Branches keep the defaults local and make new schema omissions type errors here.
  if (table === 'bookings') {
    const b = data as unknown as Fixture<'bookings'>;
    return await ctx.db.insert('bookings', { guestEmailNormalized: b.guestEmail?.trim().toLowerCase(), amountPaid: b.paymentStatus === 'paid' || b.paymentStatus === 'refunded' ? b.total : 0, amountRefunded: b.paymentStatus === 'refunded' ? b.total : 0, guestPhoneDigits: b.guestPhone.replace(/\D/g, ''), ...b }) as Id<T>;
  }
  if (table === 'appointments') {
    const a = data as unknown as Fixture<'appointments'>;
    const service = await ctx.db.get(a.serviceId), staff = await ctx.db.get(a.staffId);
    return await ctx.db.insert('appointments', { guestEmailNormalized: a.guestEmail?.trim().toLowerCase(), amountPaid: a.paymentStatus === 'unpaid' ? 0 : a.price, amountRefunded: a.paymentStatus === 'refunded' ? a.price : 0, guestPhoneDigits: a.guestPhone.replace(/\D/g, ''), serviceNameSnapshot: service?.name ?? 'Deleted service', staffNameSnapshot: staff?.name ?? 'Deleted staff', ...a }) as Id<T>;
  }
  if (table === 'orders') {
    const o = data as unknown as Fixture<'orders'>;
    return await ctx.db.insert('orders', { orderNumber: await nextCounter(ctx, 'order'), due: o.status === 'draft' ? o.total : 0, ...o }) as Id<T>;
  }
  const l = data as unknown as Fixture<'orderLines'>;
  return await ctx.db.insert('orderLines', { catalogUnitPrice: l.unitPrice, ...l }) as Id<T>;
}
