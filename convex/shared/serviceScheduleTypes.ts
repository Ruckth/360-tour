
export type Shift = { start: string; end: string };

export type RosterBreak = { start: string; end: string; label: string };

/** One person's working day: shifts minus breaks. No shifts = off. */
export type DayPlan = { shifts: Shift[]; breaks: RosterBreak[]; note?: string };
