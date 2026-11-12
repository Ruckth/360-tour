// Browser-only fixtures: no backend connection or writes.
import { getFunctionName } from "convex/server";
import { useSyncExternalStore } from "react";

/*
 * A fixture can answer named functions itself (staffAccess:listPeople, ...) from its own in-memory
 * store; its mutations then re-render every query. Functions it doesn't register keep the
 * defaults below.
 */
type Handler = (args: never) => unknown;
const queryHandlers = new Map<string, Handler>();
const mutationHandlers = new Map<string, Handler>();
let storeVersion = 0;
const storeListeners = new Set<() => void>();
const subscribeStore = (listener: () => void) => { storeListeners.add(listener); return () => { storeListeners.delete(listener); }; };
const readStoreVersion = () => storeVersion;
export function registerFixtureFunctions(handlers: { queries?: Record<string, Handler>; mutations?: Record<string, Handler> }) {
  for (const [name, handler] of Object.entries(handlers.queries ?? {})) queryHandlers.set(name, handler);
  for (const [name, handler] of Object.entries(handlers.mutations ?? {})) mutationHandlers.set(name, handler);
}
export function notifyFixtureStore() {
  storeVersion += 1;
  storeListeners.forEach((listener) => listener());
}

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

const money = { total: 2890000, currency: "THB", gross: 2890000, refunded: 0, net: 2890000, owed: 0, credit: 0, refundable: 0, refundContext: "credit",  };

function fixtureQuery(query: Parameters<typeof getFunctionName>[0], args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(query);
  // Picker fixtures supply their catalog through the real component's initial props.
  if (name === "services/admin:listServices" || name === "services/admin:listStaff") return undefined;
  if (name === "pos:ordersForBooking") return {
    balance: { total: 2890000, paid: 2890000, owed: 0, refunded: 0, credit: 0 },
    activeOrder: null,
    orders: [],
    discardedOrders: [],
    refunds: [],
  };
  if (name === "bookings/admin:bookingFinancials") return {
    revision: 0, money, payments: [], refunds: [],
    hasStripePayment: false, complete: true,
  };
  if (name === "bookings/admin:findGuests" && params.has("returning")) return [{
    guestName: "Returning Guest", guestPhone: params.get("phone") ?? "0812345678",
    guestEmail: "returning@example.com", stays: 2, lastCheckIn: "2025-01-30",
  }];
  if (name === "bookings/admin:quoteBookingEdit") {
    // The stay's stored price, or 7,000 a night once its dates change.
    const { checkIn, checkOut } = args as { checkIn: string; checkOut: string };
    if (checkIn === "2025-01-30" && checkOut === "2025-02-03") return { subtotal: 3400000, discountAmount: 510000, total: 2890000, currency: "THB", promotion: null, couponRemoved: false, repriced: false };
    const total = 700000 * Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
    return { subtotal: total, discountAmount: 0, total, currency: "THB", promotion: null, couponRemoved: false, repriced: true };
  }
  if (name === "bookings/admin:getForAdmin") return {
    _id: "booking-id", createdAt: 1738231200000, propertyId: "pool-id", guestName: "Historical Guest", guestPhone: "0812345678",
    checkIn: "2025-01-30", checkOut: "2025-02-03", guests: 2, nights: 4,
    subtotal: 3400000, discountAmount: 510000, total: 2890000, currency: "THB",
    status: "completed", paymentStatus: "paid", amountPaid: 2890000, source: "admin",
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
export function useConvexAuth() { return { isLoading: false, isAuthenticated: true }; }
export function useQuery(query: Parameters<typeof getFunctionName>[0], args: unknown) {
  useSyncExternalStore(subscribeStore, readStoreVersion, readStoreVersion);
  const handler = args === "skip" ? undefined : queryHandlers.get(getFunctionName(query));
  return handler ? handler(args as never) : fixtureQuery(query, args);
}
export function useQueries(requests: Record<string, { query: Parameters<typeof getFunctionName>[0]; args: unknown }>) {
  return Object.fromEntries(Object.entries(requests).map(([key, { query, args }]) => [key, fixtureQuery(query, args)]));
}
export function useMutation(mutation?: Parameters<typeof getFunctionName>[0]) {
  const handler = mutation ? mutationHandlers.get(getFunctionName(mutation)) : undefined;
  if (handler) return async (args: unknown) => {
    document.body.dataset.submission = JSON.stringify(args);
    try {
      return await handler(args as never);
    } finally {
      notifyFixtureStore();
    }
  };
  return async (args: unknown) => {
    document.body.dataset.submission = JSON.stringify(args);
    window.dispatchEvent(new CustomEvent("fixture-mutation", { detail: args }));
    return "fixture-booking";
  };
}
export function useAction() {
  return async () => null;
}
