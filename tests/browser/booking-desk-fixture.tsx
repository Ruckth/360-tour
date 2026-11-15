import { bahtToSatang } from "convex/shared/money";
type AdminBooking = import("convex/server").FunctionReturnType<typeof import("convex/_generated/api").api.bookings.admin.listForAdmin>["bookings"][number];
import type { Doc, Id } from "convex/_generated/dataModel";
import { DEFAULT_CASHIER_RULES } from "convex/shared/staffTypes";
import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import { AdminStaffBookingsView } from "@/components/admin/AdminStaffBookingsView";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "./checkout-transport";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { addDaysIso, nightsBetweenIso } from "@/lib/booking/dates";
import { DAY_MS, resortDateTime, resortIsoDate, resortMidnight } from "@/lib/staff-bookings";
import en from "../../messages/en.json";
import { registerFixtureFunctions } from "./convex-mock";
import "@/app.css";

/*
 * The front desk on fixture data: the hotel calendar with today's stays, the staff calendar with
 * staff, services and open times, and checkout behind them, so whole desk journeys can be counted
 * ("book spa for a staying guest", "guest leaves"). Specs fix the clock (page.clock.setFixedTime)
 * and the time zone (Asia/Bangkok) before loading. Query parameters:
 *   view=hotel|staff   the hotel calendar (default) or the staff calendar
 *   theme=dark         dark app theme
 *
 * Today's stays: Anna Schmidt leaves (฿26,000 due, an unpaid Hot stone 60 on her stay), Maya Lin
 * and Ken Tanaka arrive, Lena Fischer is in house and paid. Ken has a Thai massage 60 that started
 * ten minutes ago. Checkout runs on the in-memory checkout backend, which knows Anna's stay and
 * her Hot stone appointment by the same ids.
 *
 * window.desk.calls lists every write the screens sent, with its arguments.
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const view = params.get("view") ?? "hotel";
const EMAIL = "ploy@auraliscove.co";
const now = Date.now();
const today = resortIsoDate(Date.now());
const day = (n: number) => addDaysIso(today, n);
const at = (date: string, time: string) => resortDateTime(date, time);
const fid = <T extends string>(prefix: string, n: number) => `fx${prefix}${String(n).padStart(6, "0")}` as Id<T & never>;

const access: StaffAccessView = {
  email: EMAIL, role: "manager", pendingInvitation: null, marketingRole: null,
  cashierRules: DEFAULT_CASHIER_RULES,
  capabilities: {
    checkout: true, approve: true, operations: true, manageTeam: false, settings: false, bookings: true, services: true, customers: true,
    orders: true, chats: true, properties: true, roster: true, reports: true, marketing: false,
  },
};

// ---------- Villas and stays ----------

const villa = (n: number, name: string, pricePerNight: number) => ({
  _id: fid<"properties">("villa", n) as Id<"properties">, slug: name.toLowerCase().replace(/\s+/g, "-"), name, maxGuests: 4,
  status: "active" as const, pricePerNight: bahtToSatang(pricePerNight), currency: "THB", directDiscountPercent: 0,
});
const properties = [villa(1, "Lagoon Pool Villa", 12000), villa(2, "Garden Villa", 8500), villa(3, "Ocean Suite", 4900), villa(4, "Tideglass Pool Residence", 8500)];

type Payment = { _id: string; amount: number; method: string; origin: "manual" | "online"; effectiveAt: number };
type Stay = {
  _id: Id<"bookings">; propertyId: Id<"properties">; guestName: string; guestPhone: string; guestEmail?: string;
  checkIn: string; checkOut: string; guests: number; total: number; status: "pending" | "confirmed" | "cancelled" | "completed";
  confirmationCode: string; revision: number; payments: Payment[]; source: "admin" | "web";
};
const stay = (n: number, fields: Omit<Stay, "_id" | "revision" | "payments" | "source"> & { paid?: Payment[] }): Stay => ({
  _id: fid<"bookings">("bkg", n) as Id<"bookings">, revision: 1, source: "web", payments: fields.paid ?? [], ...fields,
});
const deposit = (id: string, amount: number, method: string, daysAgo: number): Payment => ({ _id: id, amount: bahtToSatang(amount), method, origin: method === "stripe" ? "online" : "manual", effectiveAt: now - daysAgo * DAY_MS });
const desk = {
  stays: [
    // Same ids as the checkout fixture backend: Anna's stay and its Hot stone appointment.
    stay(1, { propertyId: properties[0]._id, guestName: "Anna Schmidt", guestPhone: "+49 151 2345 6789", guestEmail: "anna@example.com", checkIn: day(-3), checkOut: today, guests: 2, total: 3600000, status: "confirmed", confirmationCode: "CONF-2026-A1B2C3", paid: [deposit("pay-anna", 10000, "stripe", 20)] }),
    stay(3, { propertyId: properties[1]._id, guestName: "Maya Lin", guestPhone: "+66 81 234 5678", guestEmail: "maya@example.com", checkIn: today, checkOut: day(3), guests: 2, total: 2550000, status: "confirmed", confirmationCode: "CONF-2026-MAYA", paid: [deposit("pay-maya", 17000, "card", 10)] }),
    stay(4, { propertyId: properties[2]._id, guestName: "Ken Tanaka", guestPhone: "+81 90 1111 2222", checkIn: today, checkOut: day(2), guests: 1, total: 980000, status: "confirmed", confirmationCode: "CONF-2026-KEN" }),
    stay(5, { propertyId: properties[3]._id, guestName: "Lena Fischer", guestPhone: "+49 170 555 0101", guestEmail: "lena@example.com", checkIn: day(-1), checkOut: day(2), guests: 3, total: 2550000, status: "confirmed", confirmationCode: "CONF-2026-LENA", paid: [deposit("pay-lena", 25500, "transfer", 5)] }),
    stay(6, { propertyId: properties[2]._id, guestName: "Somchai Prasert", guestPhone: "+66 81 555 0101", checkIn: day(4), checkOut: day(6), guests: 2, total: 980000, status: "pending", confirmationCode: "CONF-2026-SOM" }),
  ],
  appointments: [] as Doc<"appointments">[],
  calls: [] as { name: string; args: unknown }[],
};

const paidOf = (s: Stay) => s.payments.reduce((sum, p) => sum + p.amount, 0);
const money = (s: Stay) => {
  const net = paidOf(s);
  const owed = s.total - net;
  return {
    total: s.total, currency: "THB", gross: net, refunded: 0, net, owed: Math.max(0, owed), credit: Math.max(0, -owed),
    refundable: s.status === "cancelled" ? net : Math.max(0, -owed), refundContext: s.status === "cancelled" ? ("cancellation" as const) : ("credit" as const), legacyRefund: false,
  };
};
const paymentStatus = (s: Stay) => (paidOf(s) >= s.total ? "paid" : "pending") as AdminBooking["paymentStatus"];
const toAdmin = (s: Stay): AdminBooking => ({
  _id: s._id, propertyId: s.propertyId, guestName: s.guestName, guestPhone: s.guestPhone, guestEmail: s.guestEmail,
  checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests, nights: nightsBetweenIso(s.checkIn, s.checkOut), total: s.total, owed: money(s).owed,
  promotion: undefined, currency: "THB", status: s.status, paymentStatus: paymentStatus(s), paymentMethod: undefined,
  amountPaid: paymentStatus(s) === "paid" ? paidOf(s) : undefined, source: s.source, chatSessionId: undefined,
  confirmationCode: s.confirmationCode, createdAt: now - 30 * DAY_MS, revision: s.revision,
});
const find = (id: string) => desk.stays.find((s) => s._id === id);
const detail = (s: Stay) => ({
  ...toAdmin(s), redemption: null, marketingAttribution: null,
  propertyName: properties.find((p) => p._id === s.propertyId)!.name, propertyStatus: "active" as const,
  subtotal: s.total, discountAmount: 0, priceOverride: null, paidAt: s.payments[0]?.effectiveAt, refundedAt: undefined,
  hasStripePayment: s.payments.some((p) => p.method === "stripe"), checkoutLive: false, adminNotes: undefined, accessToken: undefined,
  money: money(s), createdBy: EMAIL, cancelledAt: undefined, cancelledBy: undefined, cancelReason: undefined,
  historical: s.checkIn < today, guestEmailsOff: false, confirmationEmailed: true, notifyByDefault: false,
});
const financials = (s: Stay) => ({
  revision: s.revision, money: money(s), refunds: [], legacyOrders: [], unitemised: 0, hasStripePayment: false, complete: true,
  legacyManual: { cancellable: false, reason: "No legacy payment." },
  payments: s.payments.map((p) => ({
    _id: p._id, amount: p.amount, currency: "THB", origin: p.origin, method: p.method, status: "recorded", effectiveAt: p.effectiveAt,
    recordedAt: p.effectiveAt, recordedBy: EMAIL, refunded: 0, refundable: 0, order: null,
    amendBlocker: p.origin === "online" ? "Online payments stay as the provider recorded them." : null, cancelBlocker: p.origin === "online" ? "Online" : null,
  })),
});

// ---------- Staff, services and appointments ----------

const person = (n: number, name: string, role: string, color: string) => ({
  _id: fid<"staff">("staff", n) as Id<"staff">, _creationTime: 0, name, role, color, status: "active" as const, workingHours: [], breaks: [], createdAt: 0, updatedAt: 0,
}) as Doc<"staff">;
const staff = [person(1, "Nok", "Therapist", "#0f766e"), person(2, "Ploy", "Therapist", "#b45309"), person(3, "Mali", "Senior therapist", "#7c3aed"), person(4, "Dao", "Therapist", "#be123c")];
const service = (n: number, name: string, category: string, durationMin: number, price: number, staffIds: number[]) => ({
  _id: fid<"services">("svc", n) as Id<"services">, _creationTime: 0, slug: `svc-${n}`, name, category, description: "", durationMin, bufferMin: 15, price: bahtToSatang(price), currency: "THB",
  staffIds: staffIds.map((i) => staff[i - 1]._id), status: "active" as const, createdAt: 0, updatedAt: 0,
}) as Doc<"services">;
const services = [service(1, "Thai massage 60", "Massage", 60, 1200, [1, 2, 3]), service(3, "Aroma oil massage 90", "Massage", 90, 1800, [2, 3]), service(5, "Hot stone 60", "Body", 60, 1500, [3, 4]), service(7, "Foot spa 45", "Feet & hands", 45, 600, [1, 2, 3, 4])];

let codes = 10;
function addAppointment(fields: { _id?: Id<"appointments">; serviceId: Id<"services">; staffId: Id<"staff">; start: number; guestName: string; guestPhone: string; guestEmail?: string; bookingId?: Id<"bookings">; code?: string }) {
  const svc = services.find((s) => s._id === fields.serviceId)!;
  const end = fields.start + svc.durationMin * 60_000;
  const appointment = {
    _id: fields._id ?? (fid("appt", ++codes) as Id<"appointments">), _creationTime: now, serviceId: svc._id, staffId: fields.staffId,
    serviceNameSnapshot: svc.name, staffNameSnapshot: staff.find((p) => p._id === fields.staffId)?.name, start: fields.start, end,
    blockedUntil: end + svc.bufferMin * 60_000, guestName: fields.guestName, guestPhone: fields.guestPhone, guestEmail: fields.guestEmail,
    bookingId: fields.bookingId, source: "admin", status: "booked", paymentStatus: "unpaid", price: svc.price, currency: "THB",
    confirmationCode: fields.code ?? `SVC-${String(++codes).padStart(4, "0")}`, revision: 1, createdAt: now, updatedAt: now,
  } as unknown as Doc<"appointments">;
  desk.appointments.push(appointment);
  return appointment;
}
addAppointment({ _id: fid("appt", 1) as Id<"appointments">, serviceId: services[2]._id, staffId: staff[2]._id, start: at(today, "16:00"), guestName: "Anna Schmidt", guestPhone: "+49 151 2345 6789", guestEmail: "anna@example.com", bookingId: desk.stays[0]._id, code: "SVC-0001" });
addAppointment({ serviceId: services[0]._id, staffId: staff[0]._id, start: now - 10 * 60_000, guestName: "Ken Tanaka", guestPhone: "+81 90 1111 2222", bookingId: desk.stays[2]._id, code: "SVC-0007" });

const appointmentMoney = (a: Doc<"appointments">) => {
  const net = a.paymentStatus === "paid" ? a.price : 0;
  return { gross: net, net, refunded: 0, owed: a.status === "cancelled" || a.status === "no_show" ? 0 : a.price - net };
};
/** Open times on a day: a few fixed starts, the ones still ahead today. */
function openSlots({ serviceId, date, staffId }: { serviceId: Id<"services">; date: string; staffId?: Id<"staff"> }) {
  const svc = services.find((s) => s._id === serviceId);
  const who = (svc?.staffIds ?? []).filter((id) => !staffId || id === staffId);
  return ["10:30", "12:00", "13:30", "15:00", "16:30", "18:00"]
    .map((time) => at(date, time))
    .filter((start) => start > Date.now() && who.length > 0)
    .map((start) => ({ start, staffIds: who, autoStaffId: who[0] }));
}

function write(name: string, args: unknown) {
  desk.calls.push({ name, args });
}
function fresh(s: Stay, expectedRevision: number) {
  if (s.revision !== expectedRevision) throw new Error("This booking changed. Reload and try again.");
  s.revision += 1;
}

registerFixtureFunctions({
  queries: {
    "settings/settings:publicProfile": () => ({ businessName: "Auralis Cove", checkInTime: "14:00", checkOutTime: "11:00" }),
    "bookings/admin:listForAdmin": ({ from, to }: { from: string; to: string }) => ({
      properties, blocks: [], dateBlocks: [], complete: true,
      bookings: desk.stays.filter((s) => s.checkIn < to && s.checkOut > from).map(toAdmin),
    }),
    "bookings/admin:stayAppointments": ({ bookingId }: { bookingId: string }) => ({
      appointments: desk.appointments.filter((a) => a.bookingId === bookingId).sort((a, b) => a.start - b.start).map((a) => ({
        _id: a._id, serviceName: a.serviceNameSnapshot ?? "Spa", start: a.start, price: a.price,
        currency: a.currency, status: a.status, paymentStatus: a.paymentStatus, onOrder: null,
      })),
      complete: true,
    }),
    "bookings/admin:getForAdmin": ({ bookingId }: { bookingId: string }) => {
      const s = find(bookingId);
      return s ? detail(s) : null;
    },
    "bookings/admin:bookingFinancials": ({ bookingId }: { bookingId: string }) => {
      const s = find(bookingId);
      return s ? financials(s) : null;
    },
    "bookings/admin:searchBookings": () => [],
    "pos/orders:ordersForBooking": (source: { bookingId?: string; appointmentId?: string }) => {
      const s = source.bookingId ? find(source.bookingId) : undefined;
      const a = source.appointmentId ? desk.appointments.find((row) => row._id === source.appointmentId) : undefined;
      const m = s ? money(s) : a ? appointmentMoney(a) : null;
      if (!m) return null;
      return { balance: { total: s ? s.total : a!.price, paid: m.net, owed: m.owed, refunded: 0, credit: s ? money(s).credit : 0 }, activeOrder: null, orders: [], discardedOrders: [], refunds: [] };
    },
    "services/admin:listServices": () => services,
    "services/admin:listStaff": () => staff,
    "services/admin:listSchedule": ({ from, to }: { from: number; to: number }) => {
      const shifts = [];
      for (let start = resortMidnight(resortIsoDate(from)); start < to; start += DAY_MS) {
        const date = resortIsoDate(start + 12 * 3_600_000);
        for (const p of staff) shifts.push({ staffId: p._id, start: Math.max(from, at(date, "09:00")), end: Math.min(to, at(date, "20:00")) });
      }
      return {
        staff, services, blocks: [], patternHistory: [], shifts: shifts.filter((s) => s.end > s.start),
        appointments: desk.appointments.filter((a) => a.start < to && a.blockedUntil > from).sort((a, b) => a.start - b.start),
      };
    },
    "services/admin:findOpenSlots": openSlots,
    "services/admin:previewAppointmentTime": () => ({ warnings: [], needsReason: false, problem: null }),
    "services/admin:getAppointmentReference": () => null,
    "services/admin:getAppointmentFinancials": ({ appointmentId }: { appointmentId: string }) => {
      const a = desk.appointments.find((row) => row._id === appointmentId)!;
      return { orders: [], payments: [], refunds: [], money: appointmentMoney(a), revision: a.revision ?? 0, legacyManualPayment: null, unitemised: 0 };
    },
    "pos/orders:appointmentFees": () => [],
  },
  mutations: {
    "pos/commands/openStayCheckout:openStayCheckout": async ({ bookingId }: { bookingId: Id<"bookings"> }) => {
      write("openStayCheckout", { bookingId });
      const actions = checkout.useActions();
      const { orderId } = await actions.openOrderFor({ bookingId });
      const added: Id<"appointments">[] = [];
      const skipped: { appointmentId: Id<"appointments">; reason: string }[] = [];
      for (const a of desk.appointments.filter((a) => a.bookingId === bookingId)) {
        try {
          await actions.attach({ orderId, appointmentId: a._id });
          added.push(a._id);
        } catch (err) {
          skipped.push({ appointmentId: a._id, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { orderId, added, skipped };
    },
    "bookings/commands/recordPayment:recordPayment": (args: { bookingId: string; expectedRevision: number; expectedAmount: number; method: string; effectiveAt: number; idempotencyKey: string }) => {
      write("recordPayment", args);
      const s = find(args.bookingId)!;
      if (money(s).owed !== args.expectedAmount) throw new Error("The balance changed. Review it again.");
      fresh(s, args.expectedRevision);
      s.payments.push({ _id: `pay-${args.idempotencyKey}`, amount: args.expectedAmount, method: args.method, origin: "manual", effectiveAt: args.effectiveAt });
      return null;
    },
    "bookings/commands/cancelStay:cancelStay": (args: { bookingId: string; expectedRevision: number }) => {
      write("cancelStay", args);
      const s = find(args.bookingId)!;
      fresh(s, args.expectedRevision);
      s.status = "cancelled";
      return null;
    },
    "bookings/commands/updateBooking:updateBooking": (args: { bookingId: string; action: "confirm" | "cancel"; expectedRevision: number }) => {
      write("updateBooking", args);
      const s = find(args.bookingId)!;
      fresh(s, args.expectedRevision);
      s.status = args.action === "confirm" ? "confirmed" : "cancelled";
      return null;
    },
    "services/commands/createAppointment:createAppointment": (args: { serviceId: Id<"services">; start: number; staffId?: Id<"staff">; guestName: string; guestPhone: string; guestEmail?: string; bookingId?: Id<"bookings"> }) => {
      write("createAppointment", args);
      const svc = services.find((s) => s._id === args.serviceId)!;
      const created = addAppointment({ ...args, staffId: args.staffId ?? svc.staffIds[0] });
      return { appointmentId: created._id, staffId: created.staffId, confirmationCode: created.confirmationCode, accessToken: "" };
    },
    "services/commands/updateAppointmentStatus:updateAppointmentStatus": (args: { appointmentId: string; status: Doc<"appointments">["status"] }) => {
      write("updateAppointmentStatus", args);
      const a = desk.appointments.find((row) => row._id === args.appointmentId)! as { status: string; revision?: number };
      a.status = args.status;
      a.revision = (a.revision ?? 0) + 1;
      return null;
    },
  },
});

// ---------- Checkout behind the desk ----------

const checkout = await createFixtureBackend({ staff: { role: "manager", email: EMAIL } });
window.print = () => {
  document.body.dataset.printed = String(Number(document.body.dataset.printed ?? 0) + 1);
};

type Route = { kind: "desk" } | { kind: "order"; orderId: OrderId | null } | { kind: "receipt"; orderId: OrderId };
function routeFor(href: string): Route | Promise<Route> {
  const url = new URL(href, location.origin);
  if (url.pathname.startsWith("/admin/receipt/")) return { kind: "receipt", orderId: url.pathname.split("/").pop() as OrderId };
  if (!url.pathname.startsWith("/admin/checkout")) return { kind: "desk" };
  const order = url.searchParams.get("order");
  const booking = url.searchParams.get("booking");
  const appointment = url.searchParams.get("appointment");
  // As the checkout page: ?booking= / ?appointment= open (or reuse) the source's order.
  if (booking || appointment) {
    return checkout.useActions()
      .openOrderFor(booking ? { bookingId: booking as Id<"bookings"> } : { appointmentId: appointment as Id<"appointments"> })
      .then(({ orderId }) => ({ kind: "order" as const, orderId }));
  }
  return { kind: "order", orderId: (order as OrderId | null) ?? null };
}

function Desk() {
  const [route, setRoute] = useState<Route>({ kind: "desk" });
  useEffect(() => {
    const go = (event: Event) => {
      const next = routeFor((event as CustomEvent<string>).detail);
      if (next instanceof Promise) void next.then(setRoute);
      else setRoute(next);
    };
    window.addEventListener("fixture-navigation", go);
    return () => window.removeEventListener("fixture-navigation", go);
  }, []);
  return (
    <div className="min-h-dvh bg-background text-foreground" data-fixture-ready="" data-route={route.kind}>
      <header className="flex min-h-16 items-center border-b border-border bg-card/95 px-4 sm:px-6">
        <h1 className="truncate font-serif text-2xl font-semibold tracking-tight">
          {route.kind === "desk" ? (view === "staff" ? "Staff bookings" : "Hotel bookings") : route.kind === "receipt" ? "Receipt" : "Checkout"}
        </h1>
      </header>
      {route.kind === "desk" ? (
        view === "staff" ? (
          <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 md:h-[calc(100dvh-4rem)] md:min-h-[40rem]">
            <AdminStaffBookingsView tab="calendar" />
          </div>
        ) : (
          <AdminBookingsView />
        )
      ) : (
        <CheckoutBackendProvider backend={checkout}>
          {route.kind === "receipt" ? (
            <div className="flex min-h-0 flex-1 overflow-y-auto">
              <ReceiptView orderId={route.orderId} onNewSale={() => setRoute({ kind: "order", orderId: null })} onOpenOrder={(orderId) => setRoute({ kind: "order", orderId })} />
            </div>
          ) : (
            <div className="flex h-[calc(100dvh-4rem)] flex-col">
              <CheckoutView orderId={route.orderId} onOrderChange={(orderId) => setRoute({ kind: "order", orderId })} onPaid={(orderId) => setRoute({ kind: "receipt", orderId })} />
            </div>
          )}
        </CheckoutBackendProvider>
      )}
    </div>
  );
}

declare global {
  interface Window {
    desk: { calls: () => { name: string; args: unknown }[]; appointments: () => Doc<"appointments">[] };
  }
}
window.desk = { calls: () => desk.calls, appointments: () => desk.appointments };

createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider locale="en" timeZone="Asia/Bangkok" messages={en}>
    <StaffAccessProvider access={access}>
      <ConfirmProvider>
        <Desk />
      </ConfirmProvider>
    </StaffAccessProvider>
  </NextIntlClientProvider>,
);
