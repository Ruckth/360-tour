import { maintenancePaused } from './auth/model';
import { cronJobs } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type MutationCtx, internalMutation } from './_generated/server';
import { releaseBookingDates } from './lib/availabilityWrites';
import { writeBooking } from './lib/bookingMoney';
import { resortLocalParts } from './lib/serviceSlots';
import { bookingHoldExpiresAt, BOOKING_RULE_RANGES } from './lib/siteSettings';
import { getEffectiveSettings } from './settings/model';
import type { Doc } from './_generated/dataModel';
import { RAW_MARKETING_RETENTION_MS } from './lib/marketingPolicy';
import { ATTRIBUTION_WINDOW_MS } from './lib/marketingAttribution';

if (RAW_MARKETING_RETENTION_MS <= ATTRIBUTION_WINDOW_MS) {
  throw new Error('Raw marketing retention must exceed the attribution window');
}

export const MARKETING_CLEANUP_BATCH_SIZE = 100;

/** Delete only raw rows. Aggregates, counters and frozen sale/credit snapshots are permanent. */
export const cleanRawMarketing = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args): Promise<number> => {
    if (maintenancePaused()) return 0;
    const cutoff = args.cutoff ?? Date.now() - RAW_MARKETING_RETENTION_MS;
    // Deletion advances the indexed page; no offset/cursor can skip deleted rows.
    const sessions = await ctx.db.query('marketingSessions')
      .withIndex('by_startedAt', q => q.lt('startedAt', cutoff))
      .take(MARKETING_CLEANUP_BATCH_SIZE);
    const events = await ctx.db.query('marketingEvents')
      .withIndex('by_occurredAt', q => q.lt('occurredAt', cutoff))
      .take(MARKETING_CLEANUP_BATCH_SIZE);
    for (const row of [...sessions, ...events]) await ctx.db.delete(row._id);
    if (sessions.length === MARKETING_CLEANUP_BATCH_SIZE || events.length === MARKETING_CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanRawMarketing, { cutoff });
    }
    return sessions.length + events.length;
  },
});

async function expireHold(ctx: MutationCtx, booking: Doc<'bookings'>) {
  if (booking.source === 'admin' || booking.status !== 'pending' || booking.paymentStatus === 'paid') return false;
  if (bookingHoldExpiresAt(booking) > Date.now()) return false;
  await releaseBookingDates(ctx, booking);
  // Keep the session identity/amount: a delayed signed payment webhook may still recover
  // this stay, after rechecking that no other booking has taken its nights.
  await writeBooking(
    ctx,
    booking,
    { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'system:expiry', stripeCheckoutUrl: undefined },
    { actor: 'system:expiry', kind: 'pending_expired' }
  );
  return true;
}

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
      await ctx.scheduler.runAt(expiresAt, internal.crons.expireBookingHold, args);
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
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.crons.expirePending, { cutoff, cursor: page.continueCursor });
    return expired;
  },
});

export const cleanRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (maintenancePaused()) return 0;
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
crons.cron('clean raw marketing after 90 days', '0 3 * * *', internal.crons.cleanRawMarketing, {});
crons.interval('expire unpaid bookings', { hours: 1 }, internal.crons.expirePending, {});
crons.interval('sync OTA calendars', { minutes: 30 }, internal.bookings.calendar.ical.syncAll, {});
crons.interval('clean rate limits', { hours: 1 }, internal.crons.cleanRateLimits, {});
crons.interval('clean unattached staff and service photos', { hours: 6 }, internal.services.maintenance.cleanStaffAvatarUploads, {});
crons.interval('clean pending customer displays', { minutes: 10 }, internal.pos.displays.cleanPending, {});
// 09:00 Asia/Bangkok, so guests get these in the resort's morning rather than at a deploy-relative time.
crons.cron('queue pre-arrival emails', '0 2 * * *', internal.crons.queueLifecycleEmails, { kind: 'preArrival' });
crons.cron('queue review emails', '0 2 * * *', internal.crons.queueLifecycleEmails, { kind: 'review' });
crons.interval('recover messaging turns', { minutes: 1 }, internal.messaging.worker.recover, {});
export default crons;
