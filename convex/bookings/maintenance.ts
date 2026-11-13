import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { maintenancePaused } from '../lib/maintenance';
import { BOOKING_RULE_RANGES, bookingHoldExpiresAt } from '../lib/siteSettings';
import { getEffectiveSettings } from '../settings/model';
import { resortLocalParts } from '../shared/resortLocalParts';
import { expireHold } from './private/maintenance';

export const expireBookingHold = internalMutation({
  args: { bookingId: v.id('bookings'), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    if (maintenancePaused()) return 0;
    const booking = await ctx.db.get(args.bookingId);
    if (
      !booking ||
      booking.source === 'admin' ||
      booking.status !== 'pending' ||
      booking.paymentStatus === 'paid'
    )
      return;
    // Staff edits bump the revision but must not disable expiry. Always re-read the
    // current status and deadline, so old timers also respect extended checkouts.
    const expiresAt = bookingHoldExpiresAt(booking);
    if (expiresAt > Date.now()) {
      await ctx.scheduler.runAt(expiresAt, internal.bookings.maintenance.expireBookingHold, args);
      return;
    }
    await expireHold(ctx, booking);
  }
});

export const expirePending = internalMutation({
  args: { cutoff: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (maintenancePaused()) return 0;
    // Scan from the shortest supported hold, independently of today's settings.
    // Each booking's own deadline determines whether it may expire.
    const cutoff = args.cutoff ?? Date.now() - BOOKING_RULE_RANGES.unpaidHoldMinutes[0] * 60_000;
    const page = await ctx.db.query('bookings')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'pending').lt('createdAt', cutoff))
      .paginate({ numItems: 100, cursor: args.cursor ?? null });
    let expired = 0;
    for (const booking of page.page) {
      if (await expireHold(ctx, booking)) expired++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.bookings.maintenance.expirePending, { cutoff, cursor: page.continueCursor });
    return expired;
  },
});

export const queueLifecycleEmails = internalMutation({
  args: {
    kind: v.union(v.literal('preArrival'), v.literal('review')),
    cursor: v.optional(v.string()),
    today: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (maintenancePaused()) return 0;
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      console.warn('RESEND_API_KEY or EMAIL_FROM not configured, skipping lifecycle emails');
      return 0;
    }
    // Booking dates are resort-local (Asia/Bangkok) calendar days, so "today" must be too.
    const today = args.today ?? resortLocalParts(Date.now()).date;
    const { bookingRules } = await getEffectiveSettings(ctx);
    const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    const page = args.kind === 'preArrival'
      ? await ctx.db.query('bookings').withIndex('by_status_checkIn', q => q.eq('status', 'confirmed').gte('checkIn', day(1)).lte('checkIn', day(bookingRules.preArrivalDaysBefore))).paginate({ numItems: 50, cursor: args.cursor ?? null })
      : await ctx.db.query('bookings').withIndex('by_status_checkOut', q => q.eq('status', 'confirmed').gte('checkOut', day(-7)).lte('checkOut', day(-bookingRules.reviewDaysAfter))).paginate({ numItems: 50, cursor: args.cursor ?? null });
    let queued = 0;
    for (const booking of page.page) {
      if (!booking.guestEmail?.trim()) continue;
      if (args.kind === 'preArrival') {
        if (booking.preArrivalEmailQueuedAt) continue;
        await ctx.db.patch(booking._id, { preArrivalEmailQueuedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.bookings.emails.sendPreArrival, { bookingId: booking._id });
      } else {
        if (booking.reviewEmailQueuedAt) continue;
        await ctx.db.patch(booking._id, { reviewEmailQueuedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.bookings.emails.sendReviewRequest, { bookingId: booking._id });
      }
      queued++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.bookings.maintenance.queueLifecycleEmails, { kind: args.kind, cursor: page.continueCursor, today });
    return queued;
  },
});
