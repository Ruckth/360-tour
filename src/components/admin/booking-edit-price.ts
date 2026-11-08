/** What adminBookings.quoteBookingEdit returns: the price editBooking will save for these inputs. */
export type BookingEditQuote = {
  subtotal: number;
  discountAmount: number;
  total: number;
  currency: string;
  promotion: { code: string; couponVersion: number; discount: number } | null;
  couponRemoved: boolean;
  repriced: boolean;
};

/** The quote as useQueries hands it back: loading, a refusal, or the answer. */
export type BookingEditQuoteState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; quote: BookingEditQuote };

export type BookingEditPrice =
  /** No dates to price yet. */
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unchanged"; total: number; currency: string }
  | {
      kind: "changed";
      total: number;
      currency: string;
      /** Against the current total; null when the currency changes too. */
      difference: number | null;
      /** How a repriced stay was priced, when a coupon is involved. */
      note: string | null;
    };

/**
 * The edit form's price panel. A custom price is the staff's own number; otherwise it's the
 * server's quote, which runs the same pricing editBooking applies on save (frozen coupon version,
 * own reservation excluded, direct-rate fallback), so the total reviewed is the total saved.
 */
export function bookingEditPrice({
  current,
  custom,
  quote,
}: {
  current: { total: number; currency: string; promotionCode?: string | null };
  /** The custom total typed in, or undefined when Custom price is off. Null when it doesn't parse. */
  custom?: number | null;
  quote: BookingEditQuoteState;
}): BookingEditPrice {
  if (custom !== undefined) return priced(current, custom ?? current.total, current.currency, null);
  if (quote.status === "idle") return { kind: "idle" };
  if (quote.status === "loading") return { kind: "loading" };
  if (quote.status === "error") return { kind: "error", message: quote.message };
  const { quote: q } = quote;
  if (!q.repriced) return { kind: "unchanged", total: current.total, currency: current.currency };
  return priced(current, q.total, q.currency, couponNote(q, current.promotionCode));
}

function priced(current: { total: number; currency: string }, total: number, currency: string, note: string | null): BookingEditPrice {
  if (total === current.total && currency === current.currency) return note ? { kind: "changed", total, currency, difference: 0, note } : { kind: "unchanged", total, currency };
  return { kind: "changed", total, currency, difference: currency === current.currency ? total - current.total : null, note };
}

/** "Repriced with DCNT-F1-20 (v1)" or "Coupon DCNT-F1-20 no longer applies — direct rate". */
export function couponNote(quote: Pick<BookingEditQuote, "promotion" | "couponRemoved">, previousCode?: string | null): string | null {
  if (quote.promotion) return `Repriced with ${quote.promotion.code} (v${quote.promotion.couponVersion})`;
  if (quote.couponRemoved) return previousCode ? `Coupon ${previousCode} no longer applies — direct rate` : "The coupon no longer applies — direct rate";
  return null;
}
