/** Loads one villa-month of blocked nights (`YYYY-MM`). */
export type FetchBlockedMonth = (propertyId: string, month: string) => Promise<string[]>;

type MonthState = { status: "loading" } | { status: "loaded"; dates: string[] } | { status: "failed" };

export type BlockedMonthsView = {
  /** Blocked nights of the loaded months. */
  blockedDates: string[];
  /** Months not loaded yet (never requested or in flight): their availability is unknown. */
  pendingMonths: string[];
  /** Months whose last load failed: unknown until `retry`. */
  failedMonths: string[];
};

/**
 * Blocked nights per villa and month, loaded on demand. Framework-free so its behavior can be
 * tested with controllable promises; `useVillaBlockedMonths` wraps it for React.
 *
 * - Each villa-month loads once; a failed one stays failed (unknown, never "free") until `retry`.
 * - A response is applied only if it belongs to the latest attempt for that villa-month, so a slow
 *   earlier attempt can't overwrite a retry's result.
 */
export class BlockedMonthsStore {
  private states = new Map<string, MonthState>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly fetchMonth: FetchBlockedMonth) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  /** Starts loading the months that have never been requested. */
  request(propertyId: string, months: string[]) {
    for (const month of months) {
      if (!this.states.has(key(propertyId, month))) this.load(propertyId, month);
    }
  }

  /** Loads the given months again if their last attempt failed. */
  retry(propertyId: string, months: string[]) {
    for (const month of months) {
      if (this.states.get(key(propertyId, month))?.status === "failed") this.load(propertyId, month);
    }
  }

  view(propertyId: string, months: string[]): BlockedMonthsView {
    const view: BlockedMonthsView = { blockedDates: [], pendingMonths: [], failedMonths: [] };
    for (const month of months) {
      const state = this.states.get(key(propertyId, month));
      if (state?.status === "loaded") view.blockedDates.push(...state.dates);
      else if (state?.status === "failed") view.failedMonths.push(month);
      else view.pendingMonths.push(month);
    }
    return view;
  }

  private load(propertyId: string, month: string) {
    const monthKey = key(propertyId, month);
    const attempt: MonthState = { status: "loading" };
    this.set(monthKey, attempt);
    this.fetchMonth(propertyId, month).then(
      (dates) => {
        if (this.states.get(monthKey) === attempt) this.set(monthKey, { status: "loaded", dates });
      },
      () => {
        if (this.states.get(monthKey) === attempt) this.set(monthKey, { status: "failed" });
      },
    );
  }

  private set(monthKey: string, state: MonthState) {
    this.states.set(monthKey, state);
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

function key(propertyId: string, month: string) {
  return `${propertyId}:${month}`;
}
