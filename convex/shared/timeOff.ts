import { DAY_MS, resortDateTime, resortMidnight, resortTime24, resortTodayIso as resortIsoDate } from './time';

/** Time off as entered: dates plus optional times. Blank times mean whole days. */
export type TimeOffInput = { from: string; to: string; startTime: string; endTime: string };

export function timeOffRange(input: TimeOffInput) {
  const to = input.to || input.from;
  return {
    start: resortDateTime(input.from, input.startTime || "00:00"),
    end: input.endTime ? resortDateTime(to, input.endTime) : resortMidnight(to) + DAY_MS,
  };
}

/** Longest time off the server accepts (`assertTimeOffRange`). */
export const MAX_TIME_OFF_DAYS = 60;

/** Why the server would reject this time off range, or null when it's fine. */
export function timeOffRangeProblem(range: { start: number; end: number }) {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return "Enter a valid time off date and time.";
  if (range.end <= range.start) return "Time off must end after it starts.";
  if (range.end - range.start > MAX_TIME_OFF_DAYS * DAY_MS) return `Time off can be at most ${MAX_TIME_OFF_DAYS} days.`;
  return null;
}

/** The wanted open time, else the next open time after it, else the first open time of the day. */
export function pickSlot<T extends { start: number }>(slots: readonly T[] | undefined, wanted: number | null): T | undefined {
  if (!slots?.length) return undefined;
  const earliest = (list: readonly T[]) => list.reduce<T | undefined>((best, slot) => (!best || slot.start < best.start ? slot : best), undefined);
  return (wanted === null ? undefined : earliest(slots.filter((slot) => slot.start >= wanted))) ?? earliest(slots);
}

/** The inverse of `timeOffRange`, for editing. */
export function timeOffInput(range: { start: number; end: number }): TimeOffInput {
  const startTime = resortTime24(range.start);
  const endTime = resortTime24(range.end);
  return {
    from: resortIsoDate(range.start),
    // A range ending at midnight ends on the previous day.
    to: resortIsoDate(endTime === "00:00" ? range.end - 1 : range.end),
    startTime: startTime === "00:00" ? "" : startTime,
    endTime: endTime === "00:00" ? "" : endTime,
  };
}


/** Backend's throwing adapter retains the existing public refusal text. */
export function assertTimeOffRange(start: number, end: number) {
  if (timeOffRangeProblem({ start, end })) throw new Error('Time off must be positive and at most 60 days');
}
