import type { Doc } from '../../_generated/dataModel';
import { type MutationCtx } from '../../_generated/server';
import { bookingHoldExpiresAt } from '../../lib/siteSettings';
import { releaseBookingDates } from './availabilityWrites';
import { writeBooking } from './money';

export async function expireHold(ctx: MutationCtx, booking: Doc<'bookings'>) {
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
