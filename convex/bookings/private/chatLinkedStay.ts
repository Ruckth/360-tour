import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { canAccessResortDesk } from '../../auth/model';

export async function readChatLinkedStay(ctx: QueryCtx, sessionId: Id<'conversations'>) {
  if (!(await canAccessResortDesk(ctx, 'bookings'))) return null;
  const booking = await ctx.db.query('bookings')
    .withIndex('by_chatSession', q => q.eq('chatSessionId', sessionId))
    .order('desc').first();
  if (!booking) return null;
  const property = await ctx.db.get(booking.propertyId);
  if (!property) return null;
  return { bookingId: booking._id, propertyName: property.name, checkIn: booking.checkIn, checkOut: booking.checkOut };
}
