import { describe, expect, it } from 'vitest';
import type { Id } from 'convex/_generated/dataModel';
import { appointmentEntrySlot } from '@/components/admin/appointment-entry';

const staffId = 'mali' as Id<'staff'>;
const otherId = 'nok' as Id<'staff'>;
const now = Date.UTC(2026, 10, 1, 10);
const slots = [15, 30, 45].map(minutes => ({ start: now + minutes * 60000, staffIds: [otherId], autoStaffId: otherId }));

describe('appointment entry time selection', () => {
  it('keeps the actual old date and exact minute even when the grid contains only future availability', () => {
    const wanted = Date.UTC(2020, 0, 2, 10, 7);
    expect(appointmentEntrySlot(slots, wanted, staffId, now)).toMatchObject({ start: wanted, autoStaffId: staffId });
  });
  it('preserves an already-started service instead of silently offering a later time', () => {
    expect(appointmentEntrySlot(slots, now - 7 * 60000, staffId, now)?.start).toBe(now - 7 * 60000);
  });
  it('requires an explicit actual staff choice for past work instead of inventing an automatic assignment', () => {
    expect(appointmentEntrySlot(slots, now - 60000, undefined, now)).toBeUndefined();
  });
  it('does not wait for contemporary roster availability to reconstruct the historical selection', () => {
    expect(appointmentEntrySlot(undefined, now - 60000, staffId, now)?.start).toBe(now - 60000);
  });
  it('retains current/future booking fallback to the next genuinely offered time and assigned person', () => {
    expect(appointmentEntrySlot(slots, now + 20 * 60000, staffId, now)).toEqual(slots[1]);
    expect(appointmentEntrySlot([], now + 20 * 60000, staffId, now)).toBeUndefined();
  });
});
