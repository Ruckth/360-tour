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

export function useQuery(query: Parameters<typeof getFunctionName>[0], args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(query);
  if (name === "adminBookings:findGuests" && params.has("returning")) return [{
    guestName: "Returning Guest", guestPhone: params.get("phone") ?? "0812345678",
    guestEmail: "returning@example.com", stays: 2, lastCheckIn: "2025-01-30",
  }];
  if (name === "adminBookings:getForAdmin") return {
    _id: "booking-id", createdAt: 1738231200000, propertyId: "pool-id", guestName: "Historical Guest", guestPhone: "0812345678",
    checkIn: "2025-01-30", checkOut: "2025-02-03", guests: 2, nights: 4,
    subtotal: 34000, discountAmount: 5100, total: 28900, currency: "THB",
    status: "completed", paymentStatus: "paid", amountPaid: 28900, source: "admin",
    propertyName: "Tideglass Pool Residence", hasStripePayment: false, checkoutLive: false,
  };
  return [];
}
export function useMutation() {
  return async (args: unknown) => {
    document.body.dataset.submission = JSON.stringify(args);
    window.dispatchEvent(new CustomEvent("fixture-mutation", { detail: args }));
    return "fixture-booking";
  };
}
