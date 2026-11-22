import { quotedTotalFromParam } from "@/lib/booking/coupon";
import { firstParam, type PageSearch } from "@/lib/page-search";

/** Initial `BookingFunnel` selections from `/booking` links (home quick booking, short links, villa pages). */
export function bookingFunnelProps(params: PageSearch) {
  return {
    initialCheckIn: firstParam(params, "checkin"),
    initialCheckOut: firstParam(params, "checkout"),
    initialNights: firstParam(params, "nights"),
    initialGuests: firstParam(params, "guests"),
    initialAdults: firstParam(params, "adults"),
    initialChildren: firstParam(params, "children"),
    initialProperty: firstParam(params, "unit") ?? firstParam(params, "property"),
    // Short links add ?coupon=DCNT-F1-20&mk=f1; `mk` is left in the URL for attribution.
    initialCoupon: firstParam(params, "coupon"),
  };
}

/** Booking id and per-booking access token, accepting both parameter spellings. */
export function bookingAccessParams(params: PageSearch) {
  return {
    bookingId: firstParam(params, "bookingId") ?? firstParam(params, "booking_id") ?? "",
    accessToken: firstParam(params, "token") ?? firstParam(params, "bookingToken") ?? "",
  };
}

export type PayPageProps =
  | { kind: "proposal"; token: string }
  | { kind: "booking"; bookingId: string; accessToken: string; quotedTotal: number | null };

/** `?proposal=` (even empty) selects the proposal payment; otherwise the booking payment. */
export function payPageProps(params: PageSearch): PayPageProps {
  const proposal = firstParam(params, "proposal");
  if (proposal !== undefined) return { kind: "proposal", token: proposal };
  // `quoted` is the total the booking funnel showed, so the pay page can flag a different booked total.
  return { kind: "booking", ...bookingAccessParams(params), quotedTotal: quotedTotalFromParam(firstParam(params, "quoted")) };
}
