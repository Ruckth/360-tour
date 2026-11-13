// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it('retires every root booking email action independently of args and authentication', async () => {
  const t = convexTest(schema, modules);
  for (const client of [t, t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner' })]) {
    for (const endpoint of ['sendBookingConfirmation', 'sendOwnerNotification', 'sendCancellation', 'sendPreArrival', 'sendBookingUpdated', 'sendReviewRequest']) {
      // Omit all required args: a bad-args/auth error would conceal a still-live registration.
      await expect(client.action(makeFunctionReference<'action'>(['emails', endpoint].join(':')), {}))
        .rejects.toThrow('Could not find module for: "emails"');
    }
  }
});

it('retires root maintenance exports while retaining the cron composition module', async () => {
  const t = convexTest(schema, modules);
  for (const client of [t, t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner' })]) {
    for (const endpoint of ['expireBookingHold', 'expirePending', 'queueLifecycleEmails']) {
      await expect(client.mutation(makeFunctionReference<'mutation'>(['crons', endpoint].join(':')), {}))
        .rejects.toThrow(`Expected a Convex function exported from module "crons" as \`${endpoint}\`, but there is no such export.`);
    }
  }
});

it('removes old ctx helper modules and lifted exports without compatibility implementations', async () => {
  const t = convexTest(schema, modules);
  for (const [module, endpoint] of [
    ['bookingWrites', 'createBookingRecord'], ['stayCorrections', 'recordStayRefund'],
    ['bookingPhone', 'bookingsByPhone'], ['stayOverlap', 'findBlockingNight'],
    ['availabilityWrites', 'blockBookingDates'], ['chatCoupon', 'quoteChatStay'],
  ]) {
    await expect(t.mutation(makeFunctionReference<'mutation'>([`lib/${module}`, endpoint].join(':')), {}))
      .rejects.toThrow(`Could not find module for: "lib/${module}"`);
  }
  for (const endpoint of ['appendBookingHistory', 'writeBooking', 'bookingSnapshot']) {
    await expect(t.mutation(makeFunctionReference<'mutation'>(['lib/bookingMoney', endpoint].join(':')), {}))
      .rejects.toThrow(`Expected a Convex function exported from module "lib/bookingMoney" as \`${endpoint}\`, but there is no such export.`);
  }
});

it('resolves new internal actions and maintenance to their original configuration and pause guards', async () => {
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('EMAIL_FROM', '');
  const t = convexTest(schema, modules);
  const payload = { guestName: 'Guest', guestEmail: 'guest@example.com', propertyName: 'Villa', checkIn: '2027-01-10', checkOut: '2027-01-12', nights: 2, guests: 2, total: 30000, currency: 'THB' };
  expect(await t.action(internal.bookings.emails.sendBookingConfirmation, payload)).toEqual({ sent: false, reason: 'no_api_key' });
  expect(await t.action(internal.bookings.emails.sendOwnerNotification, { ...payload, guestPhone: '+66812345678' })).toEqual({ sent: false, reason: 'missing_config' });
  expect(await t.mutation(internal.bookings.maintenance.queueLifecycleEmails, { kind: 'review' })).toBe(0);
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  expect(await t.mutation(internal.bookings.maintenance.expirePending, { cursor: 'invalid-unless-paused' })).toBe(0);
});
