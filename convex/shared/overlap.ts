

export function blocksNewBookings(booking: { status: string }): boolean {
	return booking.status === 'confirmed' || booking.status === 'completed';
}

/** Half-open ranges: [start, end). A checkout day is free for the next check-in. */
export function staysOverlap(stay: { start: string; end: string }, from: string, to: string): boolean {
	return stay.start < to && stay.end > from;
}
export type Occupancy = {
  bookings: Array<{ _id: string; propertyId: string; status: string; checkIn: string; checkOut: string }>;
  dateBlocks: Array<{ propertyId: string; start: string; end: string }>;
  blocks: Array<{ propertyId: string; date: string }>;
};

/**
 * Whether [checkIn, checkOut) on a villa overlaps a date-holding booking or a block, using the calendar's
 * loaded range. A hint for drag and drop; the server re-checks.
 */
export function stayConflicts(data: Occupancy, propertyId: string, checkIn: string, checkOut: string, excludeBookingId?: string) {
  return (
    data.bookings.some(
      (b) =>
        b._id !== excludeBookingId &&
        b.propertyId === propertyId &&
        blocksNewBookings(b) &&
        staysOverlap({ start: b.checkIn, end: b.checkOut }, checkIn, checkOut),
    ) ||
    data.dateBlocks.some((b) => b.propertyId === propertyId && staysOverlap(b, checkIn, checkOut)) ||
    data.blocks.some((b) => b.propertyId === propertyId && b.date >= checkIn && b.date < checkOut)
  );
}
