// Browser-only fixtures: no backend connection or writes.
import { getFunctionName } from "convex/server";

const params = new URLSearchParams(location.search);
const attempts = new Map<string, number>();
let liveBlocked = params.get("blocked");
window.addEventListener("fixture-availability", ((event: CustomEvent<string | null>) => {
  liveBlocked = event.detail;
}) as EventListener);
const client = {
  watchQuery(_query: unknown, args: { propertyId: string; startDate: string; endDate: string; excludeBookingId?: string }) {
    let result: string[] | undefined;
    let error: unknown;
    return {
      localQueryResult() { if (error) throw error; return result; },
      onUpdate(callback: () => void) {
        let active = true;
        const update = () => {
          result = liveBlocked && liveBlocked >= args.startDate && liveBlocked <= args.endDate ? [liveBlocked] : [];
          error = undefined;
          callback();
        };
        window.addEventListener("fixture-availability", update);
        client.query(_query, args).then(
          (value) => { if (active) { result = value; callback(); } },
          (reason) => { if (active) { error = reason; callback(); } },
        );
        return () => { active = false; window.removeEventListener("fixture-availability", update); };
      },
    };
  },
  async query(_query: unknown, args: { propertyId: string; startDate: string; endDate: string; excludeBookingId?: string }) {
    const requests = JSON.parse(document.body.dataset.availabilityRequests ?? "[]");
    document.body.dataset.availabilityRequests = JSON.stringify([...requests, args]);
    const key = `${args.propertyId}:${args.startDate}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    if (params.has("delay")) await new Promise(resolve => setTimeout(resolve, 1500));
    if (params.has("fail") && attempt === 1) throw new Error("Fixture availability unavailable");
    const blocked = params.get("blocked");
    return blocked && blocked >= args.startDate && blocked <= args.endDate ? [blocked] : [];
  },
};

export function useConvex() { return client; }
export function usePaginatedQuery() {
  return { results: [], status: "Exhausted", loadMore: () => undefined };
}

const money = { total: 28900, currency: "THB", gross: 28900, refunded: 0, net: 28900, owed: 0, credit: 0, refundable: 0, refundContext: "credit", legacyRefund: false };

function fixtureQuery(query: Parameters<typeof getFunctionName>[0], args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(query);
  // Picker fixtures supply their catalog through the real component's initial props.
  if (name === "adminServices:listServices" || name === "adminServices:listStaff") return undefined;
  if (name === "pos:ordersForBooking") return {
    balance: { total: 28900, paid: 28900, owed: 0, refunded: 0, credit: 0 },
    activeOrder: null,
    orders: [],
    discardedOrders: [],
    refunds: [],
  };
  if (name === "adminBookings:bookingFinancials") return {
    revision: 0, money, payments: [], refunds: [], legacyOrders: [], unitemised: 28900,
    legacyManual: { cancellable: false, reason: "Receipt provenance is unknown in this legacy fixture." }, hasStripePayment: false, complete: true,
  };
  if (name === "adminBookings:findGuests" && params.has("returning")) return [{
    guestName: "Returning Guest", guestPhone: params.get("phone") ?? "0812345678",
    guestEmail: "returning@example.com", stays: 2, lastCheckIn: "2025-01-30",
  }];
  if (name === "adminBookings:quoteBookingEdit") {
    // The stay's stored price, or 7,000 a night once its dates change.
    const { checkIn, checkOut } = args as { checkIn: string; checkOut: string };
    if (checkIn === "2025-01-30" && checkOut === "2025-02-03") return { subtotal: 34000, discountAmount: 5100, total: 28900, currency: "THB", promotion: null, couponRemoved: false, repriced: false };
    const total = 7000 * Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
    return { subtotal: total, discountAmount: 0, total, currency: "THB", promotion: null, couponRemoved: false, repriced: true };
  }
  if (name === "adminBookings:getForAdmin") return {
    _id: "booking-id", createdAt: 1738231200000, propertyId: "pool-id", guestName: "Historical Guest", guestPhone: "0812345678",
    checkIn: "2025-01-30", checkOut: "2025-02-03", guests: 2, nights: 4,
    subtotal: 34000, discountAmount: 5100, total: 28900, currency: "THB",
    status: "completed", paymentStatus: "paid", amountPaid: 28900, source: "admin",
    propertyName: "Tideglass Pool Residence", hasStripePayment: false, checkoutLive: false,
    revision: 0, propertyStatus: "active", priceOverride: null, money, historical: true,
    guestEmailsOff: true, confirmationEmailed: false, notifyByDefault: false,
    // Release 3a: a tracked web booking whose first link differs from its last (marketing.html?mode=source).
    ...(params.has("marketing") ? { source: "web", marketingAttribution: {
      model: "last_touch_30d@1", evidence: "tracked", sessionId: "s2", capturedAt: 1738231200000,
      last: { linkId: "l1", slug: "f1", campaignId: "c1", campaignName: "November escape · Facebook ads", source: "facebook", medium: "paid_social", entry: "link", placement: "Beach villa carousel, second card", sessionId: "s2", touchedAt: 1738224000000 },
      first: { linkId: "l2", slug: "q1", campaignId: "c2", campaignName: "Lobby QR", source: "print", medium: "qr", entry: "qr", sessionId: "s1", touchedAt: 1737964800000 },
    } } : {}),
  };
  return [];
}
export function useQuery(query: Parameters<typeof getFunctionName>[0], args: unknown) { return fixtureQuery(query, args); }
export function useQueries(requests: Record<string, { query: Parameters<typeof getFunctionName>[0]; args: unknown }>) {
  return Object.fromEntries(Object.entries(requests).map(([key, { query, args }]) => [key, fixtureQuery(query, args)]));
}
export function useMutation() {
  return async (args: unknown) => {
    document.body.dataset.submission = JSON.stringify(args);
    window.dispatchEvent(new CustomEvent("fixture-mutation", { detail: args }));
    return "fixture-booking";
  };
}
