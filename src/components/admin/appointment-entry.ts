import type { Id } from 'convex/_generated/dataModel';
import { pickSlot } from '@/lib/staff-bookings';

type EntrySlot = { start: number; staffIds: Id<'staff'>[]; autoStaffId: Id<'staff'> };

/** A historical selection is evidence, so absence from today's availability never substitutes another time/person. */
export function appointmentEntrySlot(slots: EntrySlot[] | undefined, wanted: number | null, staffId: Id<'staff'> | undefined, now: number): EntrySlot | undefined {
  if (wanted !== null && wanted < now) return staffId ? { start: wanted, staffIds: [staffId], autoStaffId: staffId } : undefined;
  return pickSlot(slots, wanted);
}

/** Completed means the service ended; its turnaround does not extend the service itself. */
export function appointmentEntryStatus(start: number, durationMin: number, now: number) {
  return start + durationMin * 60_000 < now ? 'completed' : 'booked';
}
