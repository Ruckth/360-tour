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

export const queueLifecycleEmails = internalMutation({
  args: {
    kind: v.union(v.literal('preArrival'), v.literal('review')),
    cursor: v.optional(v.string()),
    today: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      console.warn('RESEND_API_KEY or EMAIL_FROM not configured, skipping lifecycle emails');
      return 0;
    }
    const today = args.today ?? new Date().toISOString().slice(0, 10);
    const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    const page = args.kind === 'preArrival'
      ? await ctx.db.query('bookings').withIndex('by_status_checkIn', q => q.eq('status', 'confirmed').gte('checkIn', today).lte('checkIn', day(3))).paginate({ numItems: 50, cursor: args.cursor ?? null })
      : await ctx.db.query('bookings').withIndex('by_status_checkOut', q => q.eq('status', 'confirmed').gte('checkOut', day(-7)).lte('checkOut', day(-1))).paginate({ numItems: 50, cursor: args.cursor ?? null });
    let queued = 0;
    for (const booking of page.page) {
      if (!booking.guestEmail?.trim()) continue;
      if (args.kind === 'preArrival') {
        if (booking.preArrivalEmailQueuedAt) continue;
        await ctx.db.patch(booking._id, { preArrivalEmailQueuedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.emails.sendPreArrival, { bookingId: booking._id });
      } else {
        if (booking.reviewEmailQueuedAt) continue;
        await ctx.db.patch(booking._id, { reviewEmailQueuedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.emails.sendReviewRequest, { bookingId: booking._id });
      }
      queued++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.crons.queueLifecycleEmails, { kind: args.kind, cursor: page.continueCursor, today });
    return queued;
  },
});

const crons = cronJobs();
crons.interval('expire unpaid bookings', { hours: 1 }, internal.crons.expirePending, {});
crons.interval('sync OTA calendars', { minutes: 30 }, internal.ical.syncAll, {});
crons.interval('clean rate limits', { hours: 1 }, internal.crons.cleanRateLimits, {});
crons.interval('queue pre-arrival emails', { hours: 24 }, internal.crons.queueLifecycleEmails, { kind: 'preArrival' });
crons.interval('queue review emails', { hours: 24 }, internal.crons.queueLifecycleEmails, { kind: 'review' });
export default crons;
