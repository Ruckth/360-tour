import { cronJobs } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { releaseBookingDates } from './lib/availabilityWrites';

export const PENDING_BOOKING_TTL_MS = 24 * 60 * 60 * 1000;

export const expirePending = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - PENDING_BOOKING_TTL_MS;
    const bookings = await ctx.db.query('bookings')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'pending').lt('createdAt', cutoff))
      .take(100);
    let expired = 0;
    for (const booking of bookings) {
      if (booking.paymentStatus !== 'paid' && (booking.stripeCheckoutExpiresAt ? booking.stripeCheckoutExpiresAt + 60 * 60 * 1000 : 0) <= Date.now()) {
        await releaseBookingDates(ctx, booking);
        await ctx.db.patch(booking._id, { status: 'cancelled' });
        expired++;
      }
    }
    if (bookings.length === 100 && expired > 0) await ctx.scheduler.runAfter(0, internal.crons.expirePending, { cutoff });
    return expired;
  },
});

export const cleanRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('rateLimits').withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now())).take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.crons.cleanRateLimits, {});
  },
});

const crons = cronJobs();
crons.interval('expire unpaid bookings', { hours: 1 }, internal.crons.expirePending, {});
crons.interval('sync OTA calendars', { minutes: 30 }, internal.ical.syncAll, {});
crons.interval('clean rate limits', { hours: 1 }, internal.crons.cleanRateLimits, {});
export default crons;
