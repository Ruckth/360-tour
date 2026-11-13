/** Quick reasons for `ReasonField`. Staff can edit the text after picking one. */
export const REASON_CHIPS = {
  refund: ["Shortened treatment", "Guest complaint", "Charged by mistake"],
  void: ["Wrong guest", "Duplicate sale"],
  link: ["Guest asked", "Booked under another name"],
  correct: ["Wrong method picked", "Wrong amount typed"],
  discount: ["Guest complaint", "Loyal guest", "Service delay"],
} as const satisfies Record<string, readonly string[]>;

export type ReasonChipSet = keyof typeof REASON_CHIPS;
