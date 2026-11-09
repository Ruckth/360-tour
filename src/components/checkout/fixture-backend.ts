"use client";

import type { Doc, Id, TableNames } from "convex/_generated/dataModel";
import {
  MAX_QTY,
  MERGES_QTY,
  assertBillSize,
  assertDiscount,
  assertPrice,
  assertPriceOverride,
  assertTenders,
  billTotals,
  bookingChargeTotal,
  lineNet,
  orderTitle,
  round2,
} from "convex/lib/billMath";
import { paymentDateInput } from "./payment-time";
import { effectiveTime } from "convex/lib/bookingMoney";
import { normalizeCouponCode, type CouponRules } from "convex/lib/offers";
import { evaluateOrderCoupon, posCouponMessage, type PosCouponProblem } from "convex/lib/posCoupons";
import { ConvexError } from "convex/values";
import { formatMoney } from "@/components/admin/labels";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Attachable, Catalog, CheckoutActions, CheckoutBackend, Customer, FinancialRows, FinancialStream, RestoreReview, OrderFilter, OrderRow, OrderView } from "./backend";

/**
 * In-memory checkout for the dev preview (/dev/checkout-preview): sample catalog, customers, a
 * stay with a Stripe deposit and its order, an appointment, and a saved unpaid order. Mirrors the
 * rules in convex/pos.ts closely enough to click through every flow; it is not a second source
 * of truth.
 */

const ACTOR = "preview@example.com";
const ATTACHED_PRICE = "A stay is charged at its booked price. Change the price on the booking itself, then update the row.";
const ONLINE_CHECKOUT = "Online checkout is in progress. Wait for it to finish or expire before taking payment at the desk.";
const LATENCY_MS = 150;

type Order = Doc<"bills">;
type Line = Doc<"billLines">;
type LineFields = Omit<Line, "_id" | "_creationTime" | "billId" | "createdAt">;
type Guest = { name: string; phone?: string; email?: string };
type FixtureBooking = { id: Id<"bookings">; propertyId?: Id<"properties">; guest: Guest; name: string; detail: string; reference: string; price: number; deposit: number; paid: boolean; providerRefundWaived?: number; checkoutInProgress?: boolean; promotion?: { code: string; discount: number } };
type FixtureAppointment = Omit<FixtureBooking, "id"> & { appointmentId: Id<"serviceAppointments">; bookingId?: Id<"bookings">; serviceId: Id<"services">; staffId: Id<"staff">; start: number; status?: "booked" | "completed" | "no_show" | "cancelled"; revision?: number; amountPaid?: number; amountRefunded?: number };
type Source = { bookingId?: Id<"bookings">; appointmentId?: Id<"serviceAppointments"> };

const fid = <T extends TableNames>(prefix: string, n: number) => `fx${prefix}${String(n).padStart(6, "0")}` as Id<T>;
const staffId = (n: number) => fid<"staff">("staff", n);
const serviceId = (n: number) => fid<"services">("svc", n);
const propertyId = (n: number) => fid<"properties">("villa", n);

const STAFF = ["Nok", "Ploy", "Mali", "Dao"].map((name, i) => ({ _id: staffId(i + 1), name, color: ["#0f766e", "#b45309", "#7c3aed", "#be123c"][i] }));
// Photos are the repo's own images in /public. Like a real catalog, some services have none; one
// points at a missing file, so the preview also shows the fallback for a photo that fails to load.
const SERVICES: [string, string, number, number, number[], string, string?][] = [
  ["Thai massage 60", "Massage", 60, 1200, [1, 2, 3], "Traditional stretching and acupressure."],
  ["Thai massage 90", "Massage", 90, 1600, [1, 2], "The full-length traditional massage."],
  ["Aroma oil massage 90", "Massage", 90, 1800, [2, 3], "Warm oil with lemongrass or jasmine."],
  ["Four-hand massage 60", "Massage", 60, 2800, [1, 2, 3, 4], "Two therapists in sync."],
  ["Hot stone 60", "Body", 60, 1500, [3, 4], "Basalt stones and slow strokes."],
  ["Coconut body scrub 45", "Body", 45, 1100, [4], "Fresh coconut and sea salt.", "/experiences/coconut-scrub-missing.jpg"],
  ["Foot spa 45", "Feet & hands", 45, 600, [1, 2, 3, 4], "Soak, scrub and foot massage."],
  ["Reflexology 60", "Feet & hands", 60, 900, [1, 4], "Pressure-point foot massage."],
  ["Herbal flower bath 30", "Body", 30, 900, [3, 4], "Open-air tub with frangipani and lemongrass.", "/pool-villa-spa-bathroom.webp"],
  ["Sunrise yoga by the pool 60", "Wellness", 60, 1400, [2, 3], "Private session on the pool deck.", "/experiences/wellness-yoga.png"],
];

const CATALOG: Catalog = {
  services: SERVICES.map(([name, category, durationMin, price, staff, description, imageUrl], i) => ({
    _id: serviceId(i + 1), name, category, description, durationMin, price, currency: "THB", staffIds: staff.map(staffId), imageUrl,
  })),
  // As convex/pos.ts: a villa's first image. The suite has none yet.
  rooms: ([
    ["Lagoon Pool Villa", "Private pool on the lagoon", 12000, 6, "/pool-villa-veranda-view.webp"],
    ["Garden Villa", "Two bedrooms in the garden", 8500, 4, "/garden-image.webp"],
    ["Sunrise Suite", "Sea-view suite", 6200, 2, undefined],
  ] as const).map(([name, tagline, price, maxGuests, imageUrl], i) => ({
    _id: propertyId(i + 1), name, tagline, price, currency: "THB", maxGuests, imageUrl,
  })),
  extras: [
    { name: "Airport transfer", price: 1200, category: "Transport" },
    { name: "Breakfast basket", price: 450, category: "Food & drink" },
    { name: "Coconut water", price: 90, category: "Food & drink" },
    { name: "Late checkout", price: 1500, category: "Stay" },
    { name: "Laundry bag", price: 300, category: "Stay" },
  ],
  staff: STAFF,
  frequent: [`service:${serviceId(1)}`, `service:${serviceId(7)}`, `service:${serviceId(10)}`, "extra:Breakfast basket", `room:${propertyId(2)}`, `service:${serviceId(5)}`],
};

/** A coupon the preview knows, with its live counters. Codes and numbers follow docs/previews/marketing/kit/data.md. */
type FixtureCoupon = { id: Id<"coupons">; rules: CouponRules; terms: string | null };

function createCoupons(): FixtureCoupon[] {
  const coupon = (n: number, code: string, benefit: CouponRules["benefit"], scope: CouponRules["scope"], terms: string | null, rules: Partial<CouponRules> = {}): FixtureCoupon => ({
    id: fid("coupon", n), terms, rules: { code, version: 1, status: "active", benefit, scope, used: 0, discountGranted: 0, ...rules },
  });
  return [
    coupon(1, "DCNT-SPA-500", { kind: "fixed", amount: 500 }, "services", "฿500 off spa services of ฿1,500 or more. Extras and stays are not included.", { minEligibleSubtotal: 1500, used: 14, discountGranted: 7000 }),
    coupon(2, "DCNT-L-10", { kind: "percent", percent: 10 }, "accommodation_and_services", "10% off stays and spa services.", { used: 22, discountGranted: 9800 }),
    coupon(3, "DCNT-RAIN-15", { kind: "percent", percent: 15 }, "services", null, { bookTo: "2026-10-31", used: 31, discountGranted: 14_250 }),
    coupon(4, "DCNT-YOGA-200", { kind: "fixed", amount: 200 }, "services", null, { usageLimit: 20, used: 20, discountGranted: 4000 }),
    // One use left: another till can take it while this order is at payment.
    coupon(5, "DCNT-L2-300", { kind: "fixed", amount: 300 }, "services", "฿300 off spa services.", { usageLimit: 50, used: 49, discountGranted: 14_700 }),
    coupon(6, "DCNT-VILLA-10", { kind: "percent", percent: 10 }, "accommodation_and_services", null, { propertySlugs: ["tideglass-pool-residence"] }),
    coupon(7, "DCNT-F1-20", { kind: "percent", percent: 20 }, "accommodation", null, { minNights: 2, maxSaving: 3000, used: 38, discountGranted: 66_450 }),
  ];
}
/** Short links on this site and the code each carries (null: a link without an offer). */
const COUPON_LINKS: Record<string, string | null> = { q1: "DCNT-SPA-500", l: "DCNT-L-10", f1: "DCNT-F1-20", f: null, m: null };
/** Today in Asia/Bangkok, as the offer engine wants it. */
const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(Date.now());
function couponRefused(problem: PosCouponProblem, couponCode?: string): never {
  throw new ConvexError({ code: "coupon_unavailable", message: posCouponMessage(problem), problem, ...(couponCode ? { couponCode } : {}) });
}

const ANNA: Guest = { name: "Anna Schmidt", phone: "+49 151 2345 6789", email: "anna@example.com" };
const SOMCHAI: Guest = { name: "Somchai Prasert", phone: "+66 81 555 0101" };
const MIA: Guest = { name: "Mia Tanaka", phone: "+81 90 1234 5678" };

function todayAt(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function createState() {
  const now = Date.now();
  const bookings: FixtureBooking[] = [
    // Deposit taken online by Stripe; the rest is paid at checkout.
    { id: fid("bkg", 1), propertyId: propertyId(1), guest: ANNA, name: "Stay · Lagoon Pool Villa", detail: "3 nights · CONF-2026-A1B2C3", reference: "CONF-2026-A1B2C3", price: 36000, deposit: 10000, paid: false },
    { id: fid("bkg", 2), propertyId: propertyId(3), guest: MIA, name: "Stay · Sunrise Suite", detail: "1 night · CONF-2026-MIA", reference: "CONF-2026-MIA", price: 6200, deposit: 0, paid: false, checkoutInProgress: true },
  ];
  const appointments: FixtureAppointment[] = [
    { appointmentId: fid("appt", 1), bookingId: fid("bkg", 1), guest: ANNA, serviceId: serviceId(5), staffId: staffId(3), start: todayAt(16), name: "Hot stone 60", detail: "", reference: "SVC-0001", price: 1500, deposit: 0, paid: false },
    { appointmentId: fid("appt", 2), guest: SOMCHAI, serviceId: serviceId(2), staffId: staffId(1), start: todayAt(11), name: "Thai massage 90", detail: "", reference: "SVC-0002", price: 1600, deposit: 0, paid: false },
  ];
  for (const a of appointments) a.detail = `${paymentDateInput(a.start).replace("T", " ")} · ${a.reference}`;

  const customers: Doc<"customers">[] = [
    { _id: fid("cust", 1), _creationTime: now, name: "Anna Schmidt", phone: ANNA.phone, phoneDigits: "4915123456789", email: ANNA.email, emailNormalized: ANNA.email, createdBy: ACTOR, createdAt: now, updatedAt: now },
    { _id: fid("cust", 2), _creationTime: now, name: "Somchai Prasert", phone: SOMCHAI.phone, phoneDigits: "66815550101", createdBy: ACTOR, createdAt: now, updatedAt: now },
    // A namesake: a different person, listed separately.
    { _id: fid("cust", 3), _creationTime: now, name: "Anna Schmidt", phone: "+41 79 000 1122", phoneDigits: "41790001122", createdBy: ACTOR, createdAt: now, updatedAt: now },
  ];

  const base = { currency: "THB", createdBy: ACTOR, hasItems: false, itemCount: 0, total: 0, due: 0, revision: 0 } as const;
  // Anna's stay has its order from booking time; nothing is charged until it is opened.
  const stayOrder: Order = { _id: fid("bill", 1), _creationTime: now - 86_400_000, ...base, status: "draft", orderNumber: 1041, bookingId: fid("bkg", 1), createdAt: now - 86_400_000, updatedAt: now - 86_400_000 };
  // A standalone sale saved earlier, for Somchai.
  const saved: Order = {
    _id: fid("bill", 2), _creationTime: now - 3_600_000, ...base, status: "draft", orderNumber: 1042, customerId: fid("cust", 2),
    itemCount: 3, total: 780, due: 780, hasItems: true, revision: 2, createdAt: now - 3_600_000, updatedAt: now - 1_800_000,
  };
  const savedLines: Line[] = [
    { _id: fid("line", 1), _creationTime: now, billId: saved._id, kind: "service", serviceId: serviceId(7), name: "Foot spa 45", detail: "45 min", unitPrice: 600, currency: "THB", qty: 1, staffId: staffId(2), createdAt: now },
    { _id: fid("line", 2), _creationTime: now, billId: saved._id, kind: "extra", name: "Coconut water", unitPrice: 90, currency: "THB", qty: 2, createdAt: now },
  ];
  return {
    orders: new Map<Id<"bills">, Order>([[stayOrder._id, stayOrder], [saved._id, saved]]),
    lines: savedLines,
    payments: [] as Doc<"billPayments">[],
    audit: [] as Doc<"billAudit">[],
    orderHistory: [] as Doc<"recordChanges">[],
    corrections: [] as Doc<"billCorrections">[],
    refunds: [] as (OrderView["refunds"][number] & { billId: Id<"bills"> })[],
    mergeJobs: [] as Doc<"customerMergeJobs">[],
    sourcePayments: new Map<Id<"bills">, { bookingId?: Id<"bookings">; appointmentId?: Id<"serviceAppointments">; amount: number; effectiveAt: number; originalPrice: number }[]>(),
    counters: new Map([["order", 1042], ["receipt", 141]]),
    customers,
    customerHistory: [] as Doc<"recordChanges">[],
    bookings,
    appointments,
    coupons: createCoupons(),
    seq: 10,
  };
}

export function createFixtureBackend(options: { bookings?: Partial<FixtureBooking>[]; appointments?: Partial<FixtureAppointment>[]; appointmentRefunds?: Doc<"appointmentRefunds">[]; financialHistory?: Partial<{ [K in FinancialStream]: FinancialRows[K][] }>; recordedRefunds?: (OrderView["refunds"][number] & { billId: Id<"bills"> })[] } = {}): CheckoutBackend & { setAppointmentSnapshot: (id: Id<"serviceAppointments">, patch: Partial<FixtureAppointment>) => void; setBookingSnapshot: (id: Id<"bookings">, patch: Partial<FixtureBooking>) => void; setCouponSnapshot: (code: string, patch: Partial<CouponRules>) => void; appointmentSnapshot: (id: Id<"serviceAppointments">) => FixtureAppointment | undefined } {
  let state = createState();
  const feeAttempts = new Map<string, { fingerprint: string; orderId: Id<"bills">; lineId: Id<"billLines"> }>();
  state.refunds = [...new Map([
    ...(options.recordedRefunds ?? []),
    ...(options.appointmentRefunds ?? options.financialHistory?.appointmentRefunds ?? []).flatMap(r => r.billId ? [{ sourceType: "appointment" as const, _id: r._id, billId: r.billId, appointmentId: r.appointmentId, amount: r.amount, currency: r.currency, method: r.method, reason: r.reason, effectiveAt: r.effectiveAt, recordedAt: r.recordedAt, recordedBy: r.recordedBy }] : []),
    ...(options.financialHistory?.bookingRefunds ?? []).flatMap(r => r.billId ? [{ sourceType: "booking" as const, _id: r._id, billId: r.billId, bookingId: r.bookingId, amount: r.amount, currency: r.currency, method: r.method, reason: r.reason, effectiveAt: r.effectiveAt, recordedAt: r.recordedAt, recordedBy: r.recordedBy }] : []),
  ].map(r => [r._id, r])).values()];
  state.bookings = state.bookings.map(b => ({ ...b, ...options.bookings?.find(p => p.id === b.id) }));
  state.appointments = state.appointments.map(a => ({ ...a, ...options.appointments?.find(p => p.appointmentId === a.appointmentId) }));
  state.corrections.push(...(options.financialHistory?.corrections ?? []));
  state.audit.push(...(options.financialHistory?.audit ?? []));
  let version = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getVersion = () => version;
  const useVersion = () => useSyncExternalStore(subscribe, getVersion, getVersion);

  const nextId = <T extends TableNames>(prefix: string) => fid<T>(prefix, ++state.seq);
  const nextNumber = (key: string) => {
    const value = (state.counters.get(key) ?? 0) + 1;
    state.counters.set(key, value);
    return value;
  };
  const linesOf = (orderId: Id<"bills">) => state.lines.filter((line) => line.billId === orderId);
  const isOpen = (order: Order) => order.status === "draft" || order.status === "held";
  const chargePrice = (item: FixtureBooking | FixtureAppointment) => "id" in item ? bookingChargeTotal({ total: item.price, providerRefundWaived: item.providerRefundWaived }) : item.price;
  const bookingDetail = (b: FixtureBooking) => `${b.detail}${b.providerRefundWaived ? ` · ${b.providerRefundWaived} THB refunded charge waived` : ""}`;
  const stateOf = (order: Order) => (isOpen(order) ? ("unpaid" as const) : order.status === "paid" ? ("paid" as const) : order.status === "discarded" ? ("discarded" as const) : ("void" as const));
  const patchOrder = (orderId: Id<"bills">, patch: Partial<Order>) => state.orders.set(orderId, { ...state.orders.get(orderId)!, ...patch });
  const patchLine = (lineId: Id<"billLines">, patch: Partial<Line>) => {
    state.lines = state.lines.map((line) => (line._id === lineId ? { ...line, ...patch } : line));
  };
  const stayPromotion = (line: Line) => (line.kind === "booking" ? state.bookings.find((b) => b.id === line.bookingId)?.promotion ?? null : null);
  /** Prices the order's coupon with the shared engine and its live counters, as pos.ts does on every change. */
  const quoteCoupon = (orderId: Id<"bills">, coupon: FixtureCoupon) => {
    const lines = linesOf(orderId);
    return evaluateOrderCoupon({
      lines: lines.map((line) => ({ ...line, id: line._id })),
      coupon: coupon.rules,
      today: businessDate(),
      usedOnAttachedStay: lines.some((line) => stayPromotion(line)?.code === coupon.rules.code),
    });
  };
  /** Re-splits the coupon over the rows; when it no longer fits, every share goes and the problem is stored. */
  const splitCoupon = (orderId: Id<"bills">) => {
    const promotion = state.orders.get(orderId)!.promotion;
    if (!promotion) return;
    const coupon = state.coupons.find((c) => c.id === promotion.couponId)!;
    const result = quoteCoupon(orderId, coupon);
    const shares = new Map(result.ok ? result.allocation.map((share) => [share.lineId, share.discount]) : []);
    state.lines = state.lines.map((line) => (line.billId === orderId ? { ...line, couponDiscount: shares.get(line._id) || undefined } : line));
    patchOrder(orderId, { promotion: { ...promotion, discount: result.ok ? result.discount : 0, problem: result.ok ? undefined : result.problem } });
  };
  const promotionSnapshot = (orderId: Id<"bills">) => {
    const promotion = state.orders.get(orderId)!.promotion!;
    return { code: promotion.code, couponVersion: promotion.couponVersion, discount: promotion.discount };
  };
  const refresh = (orderId: Id<"bills">) => {
    splitCoupon(orderId);
    const lines = linesOf(orderId);
    const totals = billTotals(lines);
    assertBillSize(totals);
    const revision = state.orders.get(orderId)!.revision + 1;
    patchOrder(orderId, { itemCount: lines.reduce((n, l) => n + l.qty, 0), total: totals.total, due: totals.due, hasItems: lines.length > 0, revision, updatedAt: Date.now() });
  };
  const audit = (entry: Omit<Doc<"billAudit">, "_id" | "_creationTime" | "at" | "actor">) =>
    state.audit.push({ _id: nextId("audit"), _creationTime: Date.now(), at: Date.now(), actor: ACTOR, ...entry });

  const orderEvent = (orderId: Id<"bills">, kind: string, before?: unknown, after?: unknown, reason?: string) => {
    const now = Date.now();
    state.orderHistory.push({ _id: nextId("history"), _creationTime: now, entityType: "order", entityId: orderId, actor: ACTOR, recordedAt: now, effectiveAt: now, kind, before, after, ...(reason ? { reason } : {}) });
  };
  const lineSnapshot = (line: Line) => {
    const { _id: lineId, _creationTime, billId, createdAt, ...fields } = line;
    void _creationTime; void billId; void createdAt;
    return Object.fromEntries(Object.entries({ ...fields, lineId, priceOverride: fields.priceOverride ? { price: fields.priceOverride.price, note: fields.priceOverride.note } : undefined }).filter(([, value]) => value !== undefined));
  };
  const createOrder = (links: Partial<Order> = {}): Order => {
    const now = Date.now();
    const order: Order = {
      _id: nextId("bill"), _creationTime: now, status: "draft", orderNumber: nextNumber("order"), currency: "THB",
      itemCount: 0, total: 0, due: 0, hasItems: false, revision: 0, createdBy: ACTOR, createdAt: now, updatedAt: now, ...links,
    };
    state.orders.set(order._id, order);
    return order;
  };
  const editableOrder = (orderId?: Id<"bills">): Order => {
    if (!orderId) return createOrder();
    const order = state.orders.get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.status === "paid") throw new Error("This order is already paid");
    if (order.status === "void") throw new Error("This order was voided");
    if (order.status === "discarded") throw new Error("This order was discarded. Restore it from Orders → Discarded before changing or paying it.");
    return order;
  };
  const editableLine = (lineId: Id<"billLines">) => {
    const line = state.lines.find((l) => l._id === lineId);
    if (!line) throw new Error("Item not found");
    return { line, order: editableOrder(line.billId) };
  };
  const addLine = (orderId: Id<"bills">, line: LineFields) => {
    const row: Line = { _id: nextId("line"), _creationTime: Date.now(), billId: orderId, createdAt: Date.now(), ...line };
    state.lines.push(row);
    return row._id;
  };
  const sourceOf = (target: Source) =>
    target.bookingId ? state.bookings.find((b) => b.id === target.bookingId) : state.appointments.find((a) => a.appointmentId === target.appointmentId);
  const charging = (target: Source) => {
    const line = state.lines.find((l) =>
      (target.bookingId ? l.bookingId === target.bookingId : l.appointmentId === target.appointmentId) && isOpen(state.orders.get(l.billId)!));
    return line ? state.orders.get(line.billId)! : null;
  };
  const linked = (target: Source) =>
    [...state.orders.values()].find((o) => isOpen(o) && (target.bookingId ? o.bookingId === target.bookingId : o.appointmentId === target.appointmentId)) ?? null;
  const attachTo = (order: Order, target: Source) => {
    const booking = target.bookingId ? state.bookings.find((b) => b.id === target.bookingId) : undefined;
    const appointment = target.appointmentId ? state.appointments.find((a) => a.appointmentId === target.appointmentId) : undefined;
    const item = booking ?? appointment;
    if (!item) throw new Error("Booking not found");
    const what = booking ? "This booking" : "This appointment";
    const other = charging(target);
    if (other) throw new Error(other._id === order._id ? `${what} is already on this order` : `${what} is already on ${orderTitle(other.orderNumber)}`);
    if (appointment?.status === "no_show" || appointment?.status === "cancelled") throw new Error("This appointment is not chargeable. Use an explicit appointment fee instead.");
    if (item.paid) throw new Error(`${what} has nothing left to pay`);
    if (booking?.checkoutInProgress) throw new Error(ONLINE_CHECKOUT);
    if (booking) {
      addLine(order._id, { kind: "booking", bookingId: booking.id, name: booking.name, detail: bookingDetail(booking), unitPrice: chargePrice(booking), currency: "THB", qty: 1, ...(booking.deposit ? { deposit: booking.deposit } : {}) });
    } else if (appointment) {
      addLine(order._id, {
        kind: "appointment", appointmentId: appointment.appointmentId, serviceId: appointment.serviceId, name: appointment.name,
        detail: appointment.detail, unitPrice: appointment.price, currency: "THB", qty: 1, staffId: appointment.staffId, startAt: appointment.start,
      });
    }
    const current = state.orders.get(order._id)!;
    if (!current.bookingId && !current.appointmentId) {
      const stay = booking?.id ?? appointment?.bookingId;
      if (stay && !linked({ bookingId: stay })) patchOrder(order._id, { bookingId: stay });
      else if (!stay && appointment && !linked(target)) patchOrder(order._id, { appointmentId: appointment.appointmentId });
    }
    const added = linesOf(order._id).at(-1)!;
    orderEvent(order._id, "source_attached", undefined, lineSnapshot(added));
    refresh(order._id);
  };

  /** Runs a write after a short delay, like a network round trip, then notifies readers. Like a mutation, a write that throws leaves nothing behind. */
  const later = <T>(write: () => T) =>
    new Promise<T>((resolve, reject) =>
      setTimeout(() => {
        const saved = {
          ...state, sourcePayments: new Map([...state.sourcePayments].map(([key, rows]) => [key, rows.map(row => ({ ...row }))])), orders: new Map(state.orders), lines: [...state.lines], counters: new Map(state.counters),
          orderHistory: [...state.orderHistory], corrections: [...state.corrections], refunds: [...state.refunds], mergeJobs: [...state.mergeJobs], customers: [...state.customers], customerHistory: [...state.customerHistory], payments: [...state.payments], audit: [...state.audit],
          bookings: state.bookings.map((b) => ({ ...b })), appointments: state.appointments.map((a) => ({ ...a })),
          coupons: state.coupons.map((c) => ({ ...c, rules: { ...c.rules } })),
        };
        try {
          const result = write();
          version++;
          listeners.forEach((listener) => listener());
          resolve(result);
        } catch (error) {
          state = saved;
          reject(error);
        }
      }, LATENCY_MS),
    );

  const customerEvent = (customerId: Id<"customers">, kind: string, before?: unknown, after?: unknown, reason?: string) => {
    const now = Date.now();
    state.customerHistory.push({ _id: nextId("history"), _creationTime: now, entityType: "customer", entityId: customerId, actor: ACTOR, recordedAt: now, effectiveAt: now, kind, before, after, ...(reason ? { reason } : {}) });
  };
  const checkedCustomer = (id: Id<"customers">, revision?: number) => {
    const customer = state.customers.find(c => c._id === id);
    if (!customer) throw new Error("Customer not found");
    if (customer.mergedInto) throw new Error("This profile was merged. Open the kept customer.");
    if (revision !== undefined && revision !== (customer.revision ?? 0)) throw new Error("This customer changed. Go back and reopen the profile before saving.");
    return customer;
  };
  const discardedInfo = (o: Order) => o.status === "discarded" ? { at: o.discardedAt ?? o.updatedAt, by: o.discardedBy ?? null, reason: o.discardReason ?? null } : null;
  const liveFees = (id: Id<"serviceAppointments">, except?: Id<"bills">) => state.lines.filter(l => l.feeAppointmentId === id && l.billId !== except && (isOpen(state.orders.get(l.billId)!) || state.orders.get(l.billId)?.status === "paid" || (state.orders.get(l.billId)?.status === "void" && !state.orders.get(l.billId)?.voidUnreceived)));
  const feeBlocker = (a: FixtureAppointment | undefined, kind: "no_show" | "late_cancellation") => !a ? "This appointment no longer exists." : a.status !== (kind === "no_show" ? "no_show" : "cancelled") ? "The appointment status changed. Review the fee." : a.paid ? "This appointment is already paid. Record a refund of the difference instead of charging a fee." : null;
  const sourceIssue = (line: Line): OrderView["lines"][number]["sourceIssue"] => {
    if (line.feeAppointmentId && line.fee) {
      const a = state.appointments.find(a => a.appointmentId === line.feeAppointmentId);
      const message = feeBlocker(a, line.fee.kind) ?? (liveFees(line.feeAppointmentId, line.billId).length ? "A fee for this appointment is already on another order or was charged." : null);
      return message ? { kind: "settled", message } : null;
    }
    if (!line.bookingId && !line.appointmentId) return null;
    const item = sourceOf(line);
    if (!item) return { kind: "gone", message: "The booking no longer exists. Remove this row." };
    if (item.paid) return { kind: "settled", message: "This was paid since it was added. Remove it from the order." };
    if (item.checkoutInProgress) return { kind: "online", message: ONLINE_CHECKOUT };
    if ("status" in item && (item.status === "no_show" || item.status === "cancelled")) return { kind: "gone", message: "The appointment is no longer chargeable. Remove it and review an explicit fee." };
    if (chargePrice(item) !== line.unitPrice || item.deposit !== (line.deposit ?? 0) || ("id" in item ? bookingDetail(item) !== line.detail : item.staffId !== line.staffId || item.serviceId !== line.serviceId || item.start !== line.startAt)) return { kind: "changed", message: "The booked price changed. Update this row before payment." };
    return null;
  };
  const restoreCheck = (orderId: Id<"bills">): RestoreReview => {
    const o = state.orders.get(orderId); if (!o) return null;
    if (o.status !== "discarded") return { discarded: null, revision: o.revision, conflicts: [], blocking: 0, rowsLeft: 0 };
    const conflicts: Array<NonNullable<RestoreReview>["conflicts"][number]> = [];
    const lines = linesOf(orderId);
    for (const l of lines) {
      const other = l.feeAppointmentId ? liveFees(l.feeAppointmentId, orderId).map(l => state.orders.get(l.billId)!).find(isOpen) : (l.bookingId || l.appointmentId) ? charging(l) : null;
      if (other) conflicts.push({ kind: "charged_elsewhere", blocking: true, lineId: l._id, name: l.name, message: `${l.name} is now on ${orderTitle(other.orderNumber)}.`, order: { _id: other._id, title: orderTitle(other.orderNumber) } });
      else { const issue = sourceIssue(l); if (issue) conflicts.push({ ...issue, blocking: false, lineId: l._id, name: l.name, order: null }); }
    }
    const other = o.bookingId || o.appointmentId ? linked(o) : null;
    if (other && other._id !== orderId) conflicts.push({ kind: "link_shared", blocking: false, lineId: null, name: "Booking", message: `${orderTitle(other.orderNumber)} is also open for this booking. Both stay linked; nothing is charged twice.`, order: { _id: other._id, title: orderTitle(other.orderNumber) } });
    if (o.customerId) {
      const c = state.customers.find(c => c._id === o.customerId);
      const message = !c ? "The linked customer no longer exists. Link another customer or remove the link before paying." : c.mergedInto ? "The linked customer was merged into another profile. Review the customer before paying." : c.archivedAt ? "The linked customer is archived. The link stays; restore the profile or change the customer if needed." : null;
      if (message) conflicts.push({ kind: "customer", blocking: false, lineId: null, name: c?.name ?? "Customer", message, order: null });
    }
    const blocking = conflicts.filter(c => c.blocking).length;
    return { discarded: discardedInfo(o)!, revision: o.revision, conflicts, blocking, rowsLeft: lines.length - blocking };
  };
  const actions: CheckoutActions = {
    discardOrder: (args) => later(() => {
      const o = state.orders.get(args.orderId); if (!o) throw new Error("Order not found");
      if (o.status === "discarded" && o.lifecycleKey === args.idempotencyKey) return { replayed: true };
      editableOrder(o._id);
      if (o.revision !== args.expectedRevision) throw new Error("The order changed since you opened it. Review it and try again.");
      const lines = linesOf(o._id); if (!lines.length) throw new Error("This order has no items, so it isn’t listed and there is nothing to discard.");
      if (state.payments.some(p => p.billId === o._id)) throw new Error("This order has payments recorded, so it can’t be discarded.");
      patchOrder(o._id, { status: "discarded", discardedAt: Date.now(), discardedBy: ACTOR, discardReason: args.reason?.trim() || undefined, lifecycleKey: args.idempotencyKey, revision: o.revision + 1, updatedAt: Date.now() });
      orderEvent(o._id, "discarded", { ...o, lines: lines.map(lineSnapshot) }, { status: "discarded" }, args.reason);
      return { replayed: false };
    }),
    restoreOrder: (args) => later(() => {
      const o = state.orders.get(args.orderId); if (!o) throw new Error("Order not found");
      if (isOpen(o) && o.lifecycleKey === args.idempotencyKey) return { replayed: true, removed: [], warnings: [] };
      if (o.status !== "discarded") throw new Error("This order is not discarded.");
      if (o.revision !== args.expectedRevision) throw new Error("The order changed since you opened it. Review it and try again.");
      const check = restoreCheck(o._id)!;
      if (check.blocking && !args.removeConflictingRows) throw new Error("Not restored: another order has these sources. Restore without conflicting rows or leave discarded.");
      if (!check.rowsLeft) throw new Error("Not restored: every item on this order is now on another order.");
      const removed = check.conflicts.filter(c => c.blocking).map(c => ({ lineId: c.lineId!, name: c.name, reason: c.message }));
      for (const c of removed) { const l = state.lines.find(l => l._id === c.lineId)!; orderEvent(o._id, "line_removed", lineSnapshot(l), undefined, `Taken off when restoring: ${c.reason}`); state.lines = state.lines.filter(l => l._id !== c.lineId); }
      patchOrder(o._id, { status: "draft", discardedAt: undefined, discardedBy: undefined, discardReason: undefined, lifecycleKey: args.idempotencyKey });
      refresh(o._id); orderEvent(o._id, "restored", { status: "discarded" }, { status: "draft", removed });
      return { replayed: false, removed, warnings: check.conflicts.filter(c => !c.blocking) };
    }),
    addAppointmentFee: (args) => later(() => {
      if ((args.expectedRevision === undefined) !== (args.idempotencyKey === undefined)) throw new Error("Review the appointment and retry with its revision and attempt key.");
      const key = args.idempotencyKey?.trim();
      const fingerprint = JSON.stringify([args.orderId, args.appointmentId, args.kind, args.amount, args.reason]);
      const prior = key ? feeAttempts.get(key) : undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error("Fee attempt was already used with different details.");
        return { orderId: prior.orderId, lineId: prior.lineId, replayed: true };
      }
      const a = state.appointments.find(a => a.appointmentId === args.appointmentId);
      if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== (a?.revision ?? 0))) throw new Error("This appointment changed. Review it before adding a fee.");
      const blocked = feeBlocker(a, args.kind); if (blocked || !a) throw new Error(blocked ?? "Appointment not found");
      assertPrice(args.amount);
      if (args.amount <= 0 || round2(args.amount) !== args.amount || (a.price > 0 && args.amount > a.price)) throw new Error("Fee must be positive, whole satang and no more than the appointment price.");
      const others = liveFees(a.appointmentId);
      const same = others.find(l => l.billId === args.orderId && isOpen(state.orders.get(l.billId)!) && l.fee?.kind === args.kind && l.unitPrice === args.amount);
      if (same) {
        if (key) feeAttempts.set(key, { fingerprint, orderId: same.billId, lineId: same._id });
        return { orderId: same.billId, lineId: same._id, replayed: true };
      }
      if (others.length) throw new Error(`A fee for this appointment is already on ${orderTitle(state.orders.get(others[0].billId)!.orderNumber)} or was charged.`);
      const o = editableOrder(args.orderId);
      const lineId = addLine(o._id, { kind: "extra", name: `${args.kind === "no_show" ? "No-show fee" : "Late cancellation fee"} · ${a.name}`, detail: `${a.detail} · service not given`, unitPrice: args.amount, currency: "THB", qty: 1, feeAppointmentId: a.appointmentId, fee: { kind: args.kind, reason: args.reason?.trim() || undefined, by: ACTOR, at: Date.now() } });
      refresh(o._id); orderEvent(o._id, "fee_added", undefined, lineSnapshot(state.lines.find(l => l._id === lineId)!), args.reason);
      if (key) feeAttempts.set(key, { fingerprint, orderId: o._id, lineId });
      return { orderId: o._id, lineId, replayed: false };
    }),
    openOrderFor: (args) => later(() => {
      const existing = charging(args);
      if (existing) return { orderId: existing._id };
      const appointment = args.appointmentId ? state.appointments.find((a) => a.appointmentId === args.appointmentId) : undefined;
      const stay = args.bookingId ?? appointment?.bookingId;
      // As openOrderFor: the open order charging the stay, else the stay's own open order.
      const order = (stay ? charging({ bookingId: stay }) ?? linked({ bookingId: stay }) : linked(args)) ?? createOrder(stay ? { bookingId: stay } : { appointmentId: args.appointmentId });
      if (!sourceOf(args)?.paid) attachTo(order, args);
      return { orderId: order._id };
    }),
    addItem: ({ orderId, item }) => later(() => {
      const order = editableOrder(orderId);
      let line: LineFields;
      if (item.kind === "service") {
        const service = CATALOG.services.find((s) => s._id === item.serviceId)!;
        line = { kind: "service", serviceId: service._id, name: service.name, detail: `${service.durationMin} min`, unitPrice: service.price, currency: "THB", qty: 1 };
      } else if (item.kind === "room") {
        const room = CATALOG.rooms.find((r) => r._id === item.propertyId)!;
        line = { kind: "room", propertyId: room._id, name: room.name, detail: "per night", unitPrice: room.price, currency: "THB", qty: 1 };
      } else {
        if (!item.name.trim()) throw new Error("Name the item");
        assertPrice(item.price);
        line = { kind: "extra", name: item.name.trim(), unitPrice: round2(item.price), currency: "THB", qty: 1 };
      }
      const same = MERGES_QTY[line.kind]
        ? linesOf(order._id).find((l) => l.kind === line.kind && !l.fee && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
            (line.kind === "room" ? l.propertyId === line.propertyId : l.name === line.name))
        : undefined;
      const lineId = same && same.qty < MAX_QTY ? (patchLine(same._id, { qty: same.qty + 1 }), same._id) : addLine(order._id, line);
      orderEvent(order._id, same ? "line_updated" : "line_added", same ? lineSnapshot(same) : undefined, lineSnapshot(state.lines.find(l => l._id === lineId)!));
      refresh(order._id);
      return { orderId: order._id, lineId };
    }),
    attach: ({ orderId, ...target }) => later(() => {
      const order = editableOrder(orderId);
      attachTo(order, target);
      return { orderId: order._id };
    }),
    updateLine: ({ lineId, staffId: staff, startAt, qtyChange, discount }) => later(() => {
      const { line, order } = editableLine(lineId);
      if (line.fee) throw new Error("Remove and add the fee again to change its amount.");
      const patch: Partial<Line> = {};
      if (staff !== undefined) {
        const service = CATALOG.services.find((s) => s._id === line.serviceId);
        if (staff && !service?.staffIds.includes(staff)) throw new Error(`${STAFF.find((s) => s._id === staff)?.name} doesn't offer this service`);
        patch.staffId = staff ?? undefined;
      }
      if (startAt !== undefined) patch.startAt = startAt ?? undefined;
      if (qtyChange !== undefined) {
        if (!MERGES_QTY[line.kind]) throw new Error("Add another row instead: each service is its own row");
        if (!Number.isInteger(qtyChange)) throw new Error("Invalid quantity change");
        patch.qty = Math.min(Math.max(line.qty + qtyChange, 1), MAX_QTY);
      }
      if (discount !== undefined) {
        if (line.kind === "booking" && discount) throw new Error(ATTACHED_PRICE);
        if (discount) assertDiscount(discount);
        patch.discount = discount && discount.value > 0 ? discount : undefined;
      }
      if (JSON.stringify(lineSnapshot(line)) !== JSON.stringify(lineSnapshot({ ...line, ...patch }))) orderEvent(order._id, "line_updated", lineSnapshot(line), lineSnapshot({ ...line, ...patch }));
      patchLine(line._id, patch);
      refresh(order._id);
      return null;
    }),
    overrideLinePrice: ({ lineId, price, note }) => later(() => {
      const { line, order } = editableLine(lineId);
      if (line.fee) throw new Error("Remove and add the fee again to change its amount.");
      if (line.kind === "booking" && price !== null) throw new Error(ATTACHED_PRICE);
      const fromPrice = line.priceOverride?.price ?? line.unitPrice;
      if (price === null) {
        if (!line.priceOverride) return null;
        patchLine(line._id, { priceOverride: undefined });
        audit({ billId: order._id, lineId, kind: "price_override", fromPrice, toPrice: line.unitPrice, note: note.trim() || undefined });
      } else {
        const clean = assertPriceOverride(price, note);
        patchLine(line._id, { priceOverride: { price: round2(price), note: clean, by: ACTOR, at: Date.now() } });
        audit({ billId: order._id, lineId, kind: "price_override", fromPrice, toPrice: round2(price), note: clean });
      }
      refresh(order._id);
      return null;
    }),
    removeLine: ({ lineId }) => later(() => {
      const { order, line } = editableLine(lineId);
      orderEvent(order._id, "line_removed", lineSnapshot(line));
      state.lines = state.lines.filter((l) => l._id !== lineId);
      refresh(order._id);
      return null;
    }),
    updateSourceLine: ({ lineId }) => later(() => {
      const { line, order } = editableLine(lineId);
      const issue = sourceIssue(line);
      if (!issue) return { result: "current" as const };
      if (issue.kind === "online") throw new Error(issue.message);
      if (issue.kind === "changed") {
        const item = sourceOf(line)!;
        patchLine(line._id, { unitPrice: chargePrice(item), deposit: item.deposit || undefined, detail: "id" in item ? bookingDetail(item) : item.detail, ...("appointmentId" in item ? { staffId: item.staffId, serviceId: item.serviceId, startAt: item.start } : {}) });
        audit({ billId: order._id, lineId, kind: "source_updated", fromPrice: line.unitPrice, toPrice: item.price }); refresh(order._id);
        return { result: "updated" as const };
      }
      state.lines = state.lines.filter((l) => l._id !== lineId);
      audit({ billId: order._id, lineId, kind: "source_removed", fromPrice: line.unitPrice, note: line.name });
      refresh(order._id);
      return { result: "removed" as const };
    }),
    noteCouponRefusal: async () => null,
    applyOrderCoupon: ({ orderId, code, slug }) => later(() => {
      const order = editableOrder(orderId);
      let wanted = code ? normalizeCouponCode(code) : "";
      if (!wanted && slug) wanted = COUPON_LINKS[slug.toLowerCase()] ?? couponRefused({ code: "link_without_offer" });
      if (!wanted) throw new Error("Enter a coupon code.");
      const coupon = state.coupons.find((c) => c.rules.code === wanted) ?? couponRefused({ code: "not_found" });
      // As the server: a link only offers a live coupon.
      if (slug && coupon.rules.status !== "active") couponRefused({ code: "link_without_offer" }, coupon.rules.code);
      const result = quoteCoupon(order._id, coupon);
      if (!result.ok) couponRefused(result.problem, coupon.rules.code);
      const before = order.promotion ? { code: order.promotion.code } : undefined;
      patchOrder(order._id, { promotion: { couponId: coupon.id, couponVersion: coupon.rules.version, code: coupon.rules.code, discount: 0, appliedAt: Date.now(), appliedBy: ACTOR } });
      refresh(order._id);
      orderEvent(order._id, "coupon_applied", before, promotionSnapshot(order._id));
      const after = state.orders.get(order._id)!;
      return { code: after.promotion!.code, discount: after.promotion!.discount, revision: after.revision };
    }),
    removeOrderCoupon: ({ orderId }) => later(() => {
      const order = editableOrder(orderId);
      if (!order.promotion) return { revision: order.revision };
      const before = { code: order.promotion.code, discount: order.promotion.discount };
      patchOrder(order._id, { promotion: undefined });
      state.lines = state.lines.map((line) => (line.billId === order._id ? { ...line, couponDiscount: undefined } : line));
      refresh(order._id);
      orderEvent(order._id, "coupon_removed", before);
      return { revision: state.orders.get(order._id)!.revision };
    }),
    recheckOrderCoupon: ({ orderId }) => later(() => {
      const order = editableOrder(orderId);
      if (!order.promotion) throw new Error("This order has no coupon");
      refresh(order._id);
      const after = state.orders.get(order._id)!;
      return { revision: after.revision, discount: after.promotion?.discount ?? 0, problem: after.promotion?.problem ?? null };
    }),
    createCustomer: (args) => later(() => {
      const name = args.name.trim();
      if (!name) throw new Error("Enter the customer name");
      const now = Date.now();
      const phone = args.phone?.trim() || undefined;
      const email = args.email?.trim() || undefined;
      const customer: Doc<"customers"> = {
        _id: nextId("cust"), _creationTime: now, name, phone, phoneDigits: phone?.replace(/\D/g, "") || undefined, email,
        emailNormalized: email?.toLowerCase(), notes: args.notes?.trim() || undefined, revision: 0, createdBy: ACTOR, createdAt: now, updatedAt: now,
      };
      state.customers.push(customer);
      customerEvent(customer._id, "created", undefined, { name, phone, email, notes: customer.notes });
      return customer._id;
    }),
    updateCustomer: ({ customerId, expectedRevision, ...input }) => later(() => {
      const customer = checkedCustomer(customerId, expectedRevision);
      const name = input.name.trim();
      if (!name) throw new Error("Enter the customer name");
      const next = { name, phone: input.phone?.trim() || undefined, email: input.email?.trim() || undefined, notes: input.notes?.trim() || undefined };
      const before = { name: customer.name, phone: customer.phone, email: customer.email, notes: customer.notes };
      if (JSON.stringify(next) === JSON.stringify(before)) return null;
      state.customers = state.customers.map(c => c._id === customerId ? { ...c, ...next, phoneDigits: next.phone?.replace(/\D/g, ""), emailNormalized: next.email?.toLowerCase(), revision: (c.revision ?? 0) + 1, updatedAt: Date.now() } : c);
      customerEvent(customerId, "edited", before, next);
      return null;
    }),
    setCustomerArchived: ({ customerId, expectedRevision, archived }) => later(() => {
      const customer = checkedCustomer(customerId, expectedRevision);
      if (Boolean(customer.archivedAt) === archived) return null;
      state.customers = state.customers.map(c => c._id === customerId ? { ...c, archivedAt: archived ? Date.now() : undefined, revision: (c.revision ?? 0) + 1, updatedAt: Date.now() } : c);
      customerEvent(customerId, archived ? "archived" : "restored", { archived: Boolean(customer.archivedAt) }, { archived });
      return null;
    }),
    mergeCustomers: (args) => later(() => {
      const source = state.customers.find(c => c._id === args.sourceId);
      const destination = state.customers.find(c => c._id === args.destinationId);
      const reason = args.reason.trim();
      if (!source || !destination) throw new Error("Customer not found");
      if (source._id === destination._id) throw new Error("Choose two different customers");
      if (!reason || reason.length > 1000) throw new Error("Enter a merge reason (at most 1000 characters)");
      if (args.idempotencyKey.length < 8 || args.idempotencyKey.length > 100) throw new Error("Invalid merge attempt");
      if (source.mergedInto === destination._id && source.mergeKey === args.idempotencyKey) {
        if (source.mergeReason !== reason) throw new Error("This merge attempt was already used with a different reason");
        return { replayed: true, destinationId: destination._id };
      }
      checkedCustomer(args.sourceId, args.sourceRevision); checkedCustomer(args.destinationId, args.destinationRevision);
      if (destination.archivedAt) throw new Error("Restore the kept customer before merging");
      if (state.mergeJobs.some(j => j.status === "running" && j.destinationId === source._id)) throw new Error("Finish the in-progress merge before starting another merge.");
      const now = Date.now();
      const before = { sourceId: source._id, destinationId: destination._id, source: { name: source.name, phone: source.phone, email: source.email, notes: source.notes }, destination: { name: destination.name, phone: destination.phone, email: destination.email, notes: destination.notes } };
      state.customers = state.customers.map(c => c._id === source._id ? { ...c, mergedInto: destination._id, mergeKey: args.idempotencyKey, mergeReason: reason, archivedAt: c.archivedAt ?? now, revision: (c.revision ?? 0) + 1, updatedAt: now } : c._id === destination._id ? { ...c, revision: (c.revision ?? 0) + 1, updatedAt: now } : c);
      const job: Doc<"customerMergeJobs"> = { _id: nextId("merge"), _creationTime: now, sourceId: source._id, destinationId: destination._id, reason, actor: ACTOR, status: "running", movedOrders: 0, before, createdAt: now, updatedAt: now };
      state.mergeJobs.push(job);
      for (const id of [source._id, destination._id]) customerEvent(id, "merge_started", before, { sourceId: source._id, destinationId: destination._id }, reason);
      moveMergeBatch(job.sourceId);
      return { replayed: false, destinationId: destination._id };
    }),
    resumeCustomerMerge: ({ sourceId }) => later(() => { moveMergeBatch(sourceId); return null; }),
    linkCustomer: ({ orderId, customerId }) => later(() => {
      const customer = state.customers.find((c) => c._id === customerId);
      if (!customer) throw new Error("Customer not found");
      if (customer.archivedAt || customer.mergedInto) throw new Error("Restore the customer or choose the kept profile before linking.");
      const order = editableOrder(orderId);
      if (order.customerId === customerId) return { orderId: order._id };
      patchOrder(order._id, { customerId, revision: order.revision + 1, updatedAt: Date.now() });
      audit({ billId: order._id, kind: "customer_linked", customerId, note: customer.name });
      return { orderId: order._id };
    }),
    unlinkCustomer: ({ orderId }) => later(() => {
      const order = editableOrder(orderId);
      if (!order.customerId) return { orderId };
      patchOrder(order._id, { customerId: undefined, revision: order.revision + 1, updatedAt: Date.now() });
      audit({ billId: order._id, kind: "customer_unlinked", customerId: order.customerId });
      return { orderId };
    }),
    saveOrder: ({ orderId }) => later(() => {
      const order = editableOrder(orderId);
      if (!order.hasItems) throw new Error("Add an item before saving the order");
      patchOrder(orderId, { updatedAt: Date.now() });
      return null;
    }),
    clearOrder: ({ orderId }) => later(() => {
      editableOrder(orderId);
      const lines = linesOf(orderId);
      if (lines.length) orderEvent(orderId, "cleared", { lines: lines.map(lineSnapshot) });
      state.lines = state.lines.filter((l) => l.billId !== orderId);
      // As on the server (pos.clearOrder): starting over drops the coupon too.
      patchOrder(orderId, { promotion: undefined });
      audit({ billId: orderId, kind: "cleared" });
      refresh(orderId);
      return null;
    }),
    settleOrder: ({ orderId, idempotencyKey, expectedDue, expectedRevision, expectedCustomerRevision, tenders, effectiveAt, notifyGuest }) => later(() => {
      const order = state.orders.get(orderId);
      if (!order) throw new Error("Order not found");
      if (!isOpen(order)) {
        if (order.settleKey === idempotencyKey && order.receiptNumber !== undefined) return { receiptNumber: order.receiptNumber, replayed: true };
        if (order.status === "discarded") throw new Error("This order was discarded. Restore it before paying.");
        throw new Error(order.status === "void" ? "This order was voided" : "This order is already paid");
      }
      const lines = linesOf(orderId);
      if (!lines.length) throw new Error("Add an item first");
      // As settleOrder: the coupon is checked afresh (never a stored problem) before the total, with its
      // live counters, and every row's share must match what staff reviewed. Its use is consumed below.
      const promotion = order.promotion;
      const coupon = promotion ? state.coupons.find((c) => c.id === promotion.couponId)! : undefined;
      if (promotion && coupon) {
        const result = quoteCoupon(orderId, coupon);
        if (!result.ok) couponRefused(result.problem);
        const shares = new Map(result.allocation.map((share) => [share.lineId, share.discount]));
        if (result.discount !== promotion.discount || lines.some((line) => (line.couponDiscount ?? 0) !== (shares.get(line._id) ?? 0))) {
          throw new ConvexError({ code: "coupon_changed", message: `The coupon now saves ${formatMoney(result.discount)}. Check the coupon again before taking payment.`, discount: result.discount });
        }
      }
      const totals = billTotals(lines);
      if (totals.due !== round2(expectedDue) || order.revision !== expectedRevision) throw new Error("The order changed. Check the total and pay again.");
      assertTenders(tenders, totals.due);
      const customer = order.customerId ? checkedCustomer(order.customerId) : undefined;
      if (order.customerId && expectedCustomerRevision !== (customer?.revision ?? 0)) throw new Error("The customer changed. Review the customer and pay again.");
      const paymentAt = checkedEffective(effectiveAt);
      void notifyGuest; // The disconnected preview sends no emails.
      for (const line of lines) {
        const issue = sourceIssue(line); if (issue) throw new Error(`${line.name}: ${issue.message}`);
        const item = sourceOf(line);
        if (item?.paid) throw new Error(`${line.name}: this was paid since it was added. Remove it from the order.`);
      }
      state.sourcePayments.set(orderId, lines.filter(line => line.bookingId || line.appointmentId).map(line => ({ bookingId: line.bookingId, appointmentId: line.appointmentId, amount: Math.max(0, lineNet(line) - (line.deposit ?? 0)), effectiveAt: paymentAt, originalPrice: sourceOf(line)!.price })));
      for (const line of lines) {
        const item = sourceOf(line);
        if (item && (line.bookingId || line.appointmentId)) { item.paid = true; if (line.appointmentId && "appointmentId" in item) { item.price = lineNet(line); item.amountPaid = lineNet(line); item.amountRefunded = 0; } }
        if (line.staffId) patchLine(line._id, { staffName: STAFF.find((s) => s._id === line.staffId)?.name });
      }
      const now = Date.now();
      for (const tender of tenders) {
        state.payments.push({ _id: nextId("pay"), _creationTime: now, billId: orderId, ...tender, idempotencyKey, createdBy: ACTOR, createdAt: now, effectiveAt: paymentAt });
      }
      const receiptNumber = nextNumber("receipt");
      patchOrder(orderId, {
        status: "paid", receiptNumber, settleKey: idempotencyKey, total: totals.total, due: 0, paidAt: now, paidBy: ACTOR, updatedAt: now, paymentEffectiveAt: paymentAt,
        ...(customer ? { customerSnapshot: { name: customer.name, phone: customer.phone, email: customer.email } } : {}),
      });
      if (promotion && coupon) {
        coupon.rules = { ...coupon.rules, used: coupon.rules.used + 1, discountGranted: round2(coupon.rules.discountGranted + promotion.discount) };
        patchOrder(orderId, { promotion: { ...promotion, redemptionId: nextId("redemption") } });
      }
      audit({ billId: orderId, kind: "paid", toPrice: totals.due });
      return { receiptNumber, replayed: false };
    }),
    amendOrderPayment: (args) => later(() => {
      const replay = correctionReplay(args.orderId, args.idempotencyKey, "amended");
      if (replay) return { sequence: replay.sequence, replayed: true };
      const order = correctionOrder(args.orderId, args.expectedCorrectionRevision);
      const reason = checkedReason(args.reason);
      const patch: Partial<Order> = {};
      const change: Partial<Doc<"billCorrections">> = {};
      const payments = state.payments.filter(p => p.billId === order._id);
      if (args.tenders) {
        const total = round2(payments.reduce((n, p) => n + p.amount, 0));
        if (!total) throw new Error("Nothing was paid on this order, so there are no tenders to correct.");
        assertTenders(args.tenders, total);
        const before = order.amendedTenders ?? payments.map(cleanTender);
        const after = args.tenders.map(cleanTender);
        if (JSON.stringify(before) !== JSON.stringify(after)) { patch.amendedTenders = after; change.tendersBefore = before; change.tendersAfter = after; }
      }
      if (args.effectiveAt !== undefined) {
        const at = checkedEffective(args.effectiveAt);
        const before = order.paymentEffectiveAt ?? order.paidAt!;
        if (at !== before) { patch.paymentEffectiveAt = at; change.effectiveAtBefore = before; change.effectiveAtAfter = at; }
      }
      if (args.customer) {
        const customer = args.customer.customerId ? checkedCustomer(args.customer.customerId) : null;
        if (customer?.archivedAt) throw new Error("Restore this customer before linking to a new order.");
        if (customer && args.customer.expectedCustomerRevision !== (customer.revision ?? 0)) throw new Error("The customer changed. Review the customer and pay again.");
        const after = customer ? { name: customer.name, ...(customer.phone ? { phone: customer.phone } : {}), ...(customer.email ? { email: customer.email } : {}) } : null;
        const before = order.amendedCustomer !== undefined ? order.amendedCustomer : order.customerSnapshot ?? null;
        if ((order.customerId ?? null) !== args.customer.customerId || JSON.stringify(before) !== JSON.stringify(after)) {
          patch.amendedCustomer = after; patch.customerId = args.customer.customerId ?? undefined;
          Object.assign(change, { customerBefore: before, customerAfter: after, customerIdBefore: order.customerId ?? null, customerIdAfter: args.customer.customerId });
        }
      }
      if (!Object.keys(patch).length) throw new Error("Nothing changed.");
      const sequence = (order.correctionRevision ?? 0) + 1;
      addCorrection(order._id, args.idempotencyKey, sequence, "amended", reason, change);
      patchOrder(order._id, { ...patch, correctionRevision: sequence });
      if (patch.paymentEffectiveAt !== undefined) for (const row of state.sourcePayments.get(order._id) ?? []) row.effectiveAt = patch.paymentEffectiveAt;
      return { sequence, replayed: false };
    }),
    voidUnreceivedOrder: (args) => later(() => {
      if (correctionReplay(args.orderId, args.idempotencyKey, "void_unreceived")) return { replayed: true };
      const order = correctionOrder(args.orderId, args.expectedCorrectionRevision);
      const reason = checkedReason(args.reason);
      if (state.refunds.some(r => r.billId === order._id && r.amount > 0) || (options.appointmentRefunds ?? options.financialHistory?.appointmentRefunds ?? []).some(r => r.billId === order._id || linesOf(order._id).some(l => l.appointmentId === r.appointmentId))) throw new Error("Money was refunded, so money was received.");
      for (const line of linesOf(order._id)) {
        const source = sourceOf(line);
        const payment = (state.sourcePayments.get(order._id) ?? []).find(row => line.bookingId ? row.bookingId === line.bookingId : row.appointmentId === line.appointmentId);
        if (source && (!source.paid || !payment || (line.appointmentId && source.price !== lineNet(line)))) throw new Error(`${line.name} changed since it was paid here, or its original payment cannot be proved.`);
      }
      for (const line of linesOf(order._id)) {
        const source = sourceOf(line);
        const payment = (state.sourcePayments.get(order._id) ?? []).find(row => line.bookingId ? row.bookingId === line.bookingId : row.appointmentId === line.appointmentId);
        if (source && payment) { source.paid = false; if (line.appointmentId && "appointmentId" in source) { source.price = payment.originalPrice; source.amountPaid = 0; source.amountRefunded = 0; } }
      }
      // No money was received, so the coupon use is given back (a plain void keeps it).
      const used = order.promotion ? state.coupons.find((c) => c.id === order.promotion!.couponId) : undefined;
      if (used && order.promotion) used.rules = { ...used.rules, used: Math.max(0, used.rules.used - 1), discountGranted: Math.max(0, round2(used.rules.discountGranted - order.promotion.discount)) };
      const sequence = (order.correctionRevision ?? 0) + 1;
      addCorrection(order._id, args.idempotencyKey, sequence, "void_unreceived", reason);
      patchOrder(order._id, { status: "void", voidUnreceived: true, correctionRevision: sequence, voidedAt: Date.now(), voidedBy: ACTOR, voidReason: reason, updatedAt: Date.now() });
      audit({ billId: order._id, kind: "void", note: `Recorded in error, no money received: ${reason}` });
      return { replayed: false };
    }),
    voidOrder: ({ orderId, reason }) => later(() => {
      const order = state.orders.get(orderId);
      if (!reason.trim()) throw new Error("Give a reason for the void");
      if (order?.status !== "paid") throw new Error("Only a paid order can be voided");
      patchOrder(orderId, { status: "void", voidedAt: Date.now(), voidedBy: ACTOR, voidReason: reason.trim(), updatedAt: Date.now() });
      audit({ billId: orderId, kind: "void", note: reason.trim() });
      return null;
    }),
  };

  const checkedEffective = effectiveTime;
  const checkedReason = (reason: string) => { if (!reason.trim() || reason.trim().length > 500) throw new Error("Enter a reason (at most 500 characters)"); return reason.trim(); };
  const cleanTender = (p: OrderView["paymentRecord"]["tenders"][number]) => ({ method: p.method, amount: p.amount, ...(p.received !== undefined ? { received: p.received } : {}) });
  const correctionReplay = (orderId: Id<"bills">, key: string, kind: Doc<"billCorrections">["kind"]) => {
    if (key.trim().length < 8 || key.trim().length > 100) throw new Error("Invalid correction attempt");
    const row = state.corrections.find(c => c.billId === orderId && c.idempotencyKey === key.trim());
    if (row && row.kind !== kind) throw new Error("This correction attempt was already used for another action.");
    return row;
  };
  const correctionOrder = (orderId: Id<"bills">, revision: number) => {
    const order = state.orders.get(orderId);
    if (order?.status !== "paid") throw new Error("Only a paid order’s payment can be corrected.");
    if ((order.correctionRevision ?? 0) !== revision) throw new Error("The payment recording changed. Review it before correcting again.");
    return order;
  };
  const addCorrection = (billId: Id<"bills">, idempotencyKey: string, sequence: number, kind: Doc<"billCorrections">["kind"], reason: string, change: Partial<Doc<"billCorrections">> = {}) => {
    state.corrections.push({ _id: nextId("correction"), _creationTime: Date.now(), billId, sequence, kind, reason, actor: ACTOR, recordedAt: Date.now(), idempotencyKey: idempotencyKey.trim(), ...change });
  };
  const moveMergeBatch = (sourceId: Id<"customers">) => {
    const job = state.mergeJobs.find(j => j.sourceId === sourceId);
    if (!job) throw new Error("No merge to resume");
    if (job.status === "completed") return;
    const rows = [...state.orders.values()].filter(o => o.customerId === sourceId).slice(0, 101);
    for (const order of rows.slice(0, 100)) {
      patchOrder(order._id, { customerId: job.destinationId, ...(isOpen(order) ? { revision: order.revision + 1 } : {}) });
      orderEvent(order._id, "customer_merged", { customerId: sourceId }, { customerId: job.destinationId }, job.reason);
    }
    const completed = rows.length <= 100;
    const movedOrders = job.movedOrders + Math.min(rows.length, 100);
    state.mergeJobs = state.mergeJobs.map(j => j._id === job._id ? { ...j, movedOrders, updatedAt: Date.now(), status: completed ? "completed" : "running", ...(completed ? { completedAt: Date.now() } : {}) } : j);
    if (completed) for (const id of [job.sourceId, job.destinationId]) customerEvent(id, "merged", job.before, { sourceId, destinationId: job.destinationId, movedOrders }, job.reason);
    else void later(() => moveMergeBatch(sourceId));
  };
  const usePage = <T,>(results: T[], key: string) => {
    const [limit, setLimit] = useState({ key, count: 20 });
    const count = limit.key === key ? limit.count : 20;
    return { results: results.slice(0, count), status: results.length > count ? "CanLoadMore" as const : "Exhausted" as const, loadMore: (n: number) => setLimit({ key, count: count + n }) };
  };
  const card = (customer: Doc<"customers">): Customer => ({ _id: customer._id, name: customer.name, phone: customer.phone, email: customer.email, revision: customer.revision ?? 0, archivedAt: customer.archivedAt, mergedInto: customer.mergedInto });
  type SourceRef = OrderView["sources"][number];
  const stayRef = (bookingId: Id<"bookings">, linked: boolean): SourceRef | null => {
    const b = state.bookings.find((x) => x.id === bookingId);
    return b ? { kind: "booking", id: b.id, reference: b.reference, guestName: b.guest.name, guestPhone: b.guest.phone, guestEmail: b.guest.email, name: b.name, linked } : null;
  };
  const appointmentRef = (appointmentId: Id<"serviceAppointments">, linked: boolean): SourceRef | null => {
    const a = state.appointments.find((x) => x.appointmentId === appointmentId);
    return a ? { kind: "appointment", id: a.appointmentId, reference: a.reference, guestName: a.guest.name, guestPhone: a.guest.phone, guestEmail: a.guest.email, name: a.name, linked } : null;
  };
  /** Same rule as orderSourceRefs in convex/pos.ts: the order's own booking, then charged stays, then charged appointments not part of a listed stay. */
  const sourceRefs = (order: Order): SourceRef[] => {
    const refs: SourceRef[] = [];
    const stays = new Set<string>();
    const appts = new Set<string>();
    const push = (ref: SourceRef | null) => {
      if (ref) refs.push(ref);
    };
    if (order.bookingId) {
      stays.add(order.bookingId);
      push(stayRef(order.bookingId, true));
    } else if (order.appointmentId) {
      appts.add(order.appointmentId);
      push(appointmentRef(order.appointmentId, true));
    }
    const lines = linesOf(order._id);
    for (const { bookingId } of lines) {
      if (!bookingId || stays.has(bookingId)) continue;
      stays.add(bookingId);
      push(stayRef(bookingId, false));
    }
    for (const { appointmentId } of lines) {
      if (!appointmentId || appts.has(appointmentId)) continue;
      appts.add(appointmentId);
      const stay = state.appointments.find((a) => a.appointmentId === appointmentId)?.bookingId;
      if (!stay || !stays.has(stay)) push(appointmentRef(appointmentId, false));
    }
    return refs;
  };
  const allRefunds = () => [...new Map([
    ...state.refunds,
    ...(options.appointmentRefunds ?? options.financialHistory?.appointmentRefunds ?? []).flatMap(r => r.billId ? [{ sourceType: "appointment" as const, _id: r._id, billId: r.billId, appointmentId: r.appointmentId, amount: r.amount, currency: r.currency, method: r.method, reason: r.reason, effectiveAt: r.effectiveAt, recordedAt: r.recordedAt, recordedBy: r.recordedBy }] : []),
    ...(options.financialHistory?.bookingRefunds ?? []).flatMap(r => r.billId ? [{ sourceType: "booking" as const, _id: r._id, billId: r.billId, bookingId: r.bookingId, amount: r.amount, currency: r.currency, method: r.method, reason: r.reason, effectiveAt: r.effectiveAt, recordedAt: r.recordedAt, recordedBy: r.recordedBy }] : []),
  ].map(r => [r._id, r])).values()];
  const orderView = (orderId: Id<"bills">): OrderView | null => {
    const order = state.orders.get(orderId);
    if (!order) return null;
    const lines = linesOf(orderId);
    const customer = state.customers.find((c) => c._id === order.customerId);
    const parent = order.parentOrderId ? state.orders.get(order.parentOrderId) : undefined;
    return {
      order: { ...order, title: orderTitle(order.orderNumber), state: stateOf(order) },
      customer: customer ? card(customer) : null,
      receiptCustomer: order.customerSnapshot ?? null,
      legacyGuest: null,
      source: sourceRefs(order)[0] ?? null,
      sources: sourceRefs(order),
      parentOrder: parent ? { _id: parent._id, title: orderTitle(parent.orderNumber) } : null,
      lines: lines.map((line) => ({
        ...line,
        net: lineNet(line),
        imageUrl: linePhoto(line),
        staffName: line.staffId ? (isOpen(order) ? undefined : line.staffName) ?? STAFF.find((s) => s._id === line.staffId)?.name : undefined,
        sourceIssue: isOpen(order) ? sourceIssue(line) : null,
        stayCoupon: stayPromotion(line),
      })),
      promotion: order.promotion ? {
        code: order.promotion.code, couponVersion: order.promotion.couponVersion, discount: order.promotion.discount, problem: order.promotion.problem ?? null,
        terms: state.coupons.find((c) => c.id === order.promotion!.couponId)?.terms ?? null,
      } : null,
      payments: state.payments.filter((p) => p.billId === orderId),
      audit: state.audit.filter((a) => a.billId === orderId).toReversed().slice(0, 50),
      totals: billTotals(lines),
      paymentRecord: {
        effectiveAt: order.paymentEffectiveAt ?? order.paidAt ?? null,
        tenders: order.amendedTenders ?? state.payments.filter(p => p.billId === orderId).map(cleanTender),
        tendersAmended: order.amendedTenders !== undefined,
        customer: order.amendedCustomer !== undefined ? order.amendedCustomer : order.customerSnapshot ?? null,
        customerAmended: order.amendedCustomer !== undefined,
        correctionRevision: order.correctionRevision ?? 0, voidUnreceived: order.voidUnreceived ?? false,
      },
      discarded: discardedInfo(order),
      corrections: state.corrections.filter(c => c.billId === orderId).toReversed().slice(0, 20),
      refunds: [...allRefunds().filter(r => r.billId === orderId && r.sourceType === "booking").slice(0, 100), ...allRefunds().filter(r => r.billId === orderId && r.sourceType === "appointment").toReversed().slice(0, 100)].sort((a,b) => b.recordedAt - a.recordedAt).map(({ billId, ...refund }) => { void billId; return refund; }),
    };
  };
  /** As linePhoto in convex/pos.ts: the service's, room's or booked villa's photo, looked up, never stored. */
  const linePhoto = (line: Line) => {
    if (line.serviceId) return CATALOG.services.find((s) => s._id === line.serviceId)?.imageUrl;
    const property = line.propertyId ?? state.bookings.find((b) => b.id === line.bookingId)?.propertyId;
    return CATALOG.rooms.find((r) => r._id === property)?.imageUrl;
  };
  const orderRow = (order: Order): OrderRow => {
    const refs = sourceRefs(order);
    return {
    _id: order._id, orderNumber: order.orderNumber, title: orderTitle(order.orderNumber), state: stateOf(order), itemCount: order.itemCount,
    total: order.total, due: isOpen(order) ? order.due ?? billTotals(linesOf(order._id)).due : 0, currency: order.currency, updatedAt: order.updatedAt, receiptNumber: order.receiptNumber,
    customerName: order.customerSnapshot?.name ?? state.customers.find((c) => c._id === order.customerId)?.name,
    discarded: discardedInfo(order),
    bookingReference: refs[0]?.reference, otherBookings: Math.max(refs.length - 1, 0),
    };
  };
  const matches = (text: string, guest: Guest) => {
    const digits = text.replace(/\D/g, "");
    return guest.name.toLowerCase().includes(text.toLowerCase()) || (digits.length >= 4 && (guest.phone ?? "").replace(/\D/g, "").includes(digits));
  };
  /** Exact phone digits or case-insensitive email, as convex/pos.ts listAttachable matches contacts. */
  const sameContact = (guest: Guest, contact: { phoneDigits?: string; emailNormalized?: string }) =>
    (Boolean(contact.phoneDigits) && (guest.phone ?? "").replace(/\D/g, "") === contact.phoneDigits) ||
    (Boolean(contact.emailNormalized) && (guest.email ?? "").trim().toLowerCase() === contact.emailNormalized);

  return {
    // Fixture-only external source snapshots model changes made by the real appointment/stay editors.
    // They are never exposed in CheckoutActions or used by production UI.
    setAppointmentSnapshot: (id, patch) => { state.appointments = state.appointments.map(a => { if (a.appointmentId !== id) return a; const next = { ...a, ...patch }; return { ...next, detail: `${paymentDateInput(next.start).replace("T", " ")} · ${next.reference}` }; }); version++; listeners.forEach(fn => fn()); },
    setBookingSnapshot: (id, patch) => { state.bookings = state.bookings.map(b => b.id === id ? { ...b, ...patch } : b); version++; listeners.forEach(fn => fn()); },
    setCouponSnapshot: (code, patch) => { state.coupons = state.coupons.map(c => c.rules.code === code ? { ...c, rules: { ...c.rules, ...patch } } : c); version++; listeners.forEach(fn => fn()); },
    appointmentSnapshot: (id) => state.appointments.find(a => a.appointmentId === id),
    useRestoreCheck: (orderId) => { useVersion(); return restoreCheck(orderId); },
    useAppointmentFees: (appointmentId) => { useVersion(); return state.lines.filter(l => l.feeAppointmentId === appointmentId && l.fee).toReversed().slice(0, 20).map(l => { const o = state.orders.get(l.billId)!; return { lineId: l._id, kind: l.fee!.kind, amount: lineNet(l), currency: l.currency, reason: l.fee!.reason ?? null, by: l.fee!.by, at: l.fee!.at, order: { _id: o._id, title: orderTitle(o.orderNumber), state: stateOf(o), receiptNumber: o.receiptNumber ?? null } }; }); },
    useCorrectionHistory: (id) => { useVersion(); return usePage(state.corrections.filter(r => r.billId === id).toReversed(), id); },
    useAuditHistory: (id) => { useVersion(); return usePage(state.audit.filter(r => r.billId === id).toReversed(), id); },
    useBookingRefundHistory: (id) => { useVersion(); return usePage((options.financialHistory?.bookingRefunds ?? state.refunds.flatMap(r => "bookingId" in r ? [r] : [])).filter(r => r.billId === id).toReversed(), id); },
    useAppointmentRefundHistory: (id) => { useVersion(); return usePage((options.appointmentRefunds ?? options.financialHistory?.appointmentRefunds ?? []).filter(r => r.billId === id).toReversed(), id); },
    useCatalog: () => CATALOG,
    useOrder: (orderId) => {
      const v = useVersion();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      return useMemo(() => (orderId ? orderView(orderId) : null), [orderId, v]);
    },
    useOrderHistory: (orderId) => {
      useVersion();
      return usePage(state.orderHistory.filter(r => r.entityId === orderId).toReversed(), orderId);
    },
    useOrders: (filter: OrderFilter) => {
      const v = useVersion();
      const results = useMemo(
        () => [...state.orders.values()].filter((o) => o.hasItems && stateOf(o) === filter).sort((a, b) => b.updatedAt - a.updatedAt).map(orderRow),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
        [filter, v],
      );
      return usePage(results, filter);
    },
    useCustomerSearch: (query) => {
      const v = useVersion();
      const text = query.trim();
      return useMemo(
        () => (text.length < 2 ? [] : state.customers.filter((c) => !c.archivedAt && !c.mergedInto && (matches(text, c) || (text.includes("@") && c.emailNormalized === text.toLowerCase()))).map(card)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
        [text, v],
      );
    },
    useCustomerPage(query, archived) {
      const suggestions = this.useCustomerSearch(query);
      const v = useVersion();
      const text = query.trim();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      const results = useMemo(() => text.length >= 2 && !archived ? suggestions ?? [] : state.customers.filter(c => Boolean(c.archivedAt) === archived && (text.length < 2 || matches(text, c) || c.emailNormalized === text.toLowerCase())).map(card), [text, archived, suggestions, v]);
      const page = usePage(results, `${text}:${archived}`);
      return { ...page, status: text.length >= 2 && !archived && suggestions === undefined ? "LoadingFirstPage" as const : page.status };
    },
    useCustomer: (customerId) => {
      const v = useVersion();
      return useMemo(() => {
        const customer = state.customers.find(c => c._id === customerId);
        return customer ? { ...card(customer), notes: customer.notes, ordersHasMore: [...state.orders.values()].filter(o => o.customerId === customerId).length > 10, mergeEnabled: true, mergeProgress: state.mergeJobs.find(j => j.sourceId === customerId) ?? null, orders: [...state.orders.values()].filter(o => o.customerId === customerId).slice(0, 10).map(o => ({ _id: o._id, title: orderTitle(o.orderNumber), state: stateOf(o), total: o.total, currency: o.currency, updatedAt: o.updatedAt })) } : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      }, [customerId, v]);
    },
    useCustomerHistory: (customerId) => {
      const v = useVersion();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      const results = useMemo(() => state.customerHistory.filter(c => c.entityId === customerId).toReversed(), [customerId, v]);
      return usePage(results, customerId);
    },
    useCustomerOrders: (customerId) => {
      const v = useVersion();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      const results = useMemo(() => [...state.orders.values()].filter(o => o.customerId === customerId).map(o => ({ _id: o._id, title: orderTitle(o.orderNumber), state: stateOf(o), total: o.total, currency: o.currency })), [customerId, v]);
      return usePage(results, customerId);
    },
    useAttachable: ({ orderId, query }) => {
      const v = useVersion();
      const text = query.trim();
      return useMemo<Attachable[] | undefined>(() => {
        const order = orderId ? state.orders.get(orderId) : undefined;
        const customer = state.customers.find((c) => c._id === order?.customerId);
        if (!order && text.length < 2) return undefined;
        const wanted = (guest: Guest, ids: { bookingId?: string; reference: string }) =>
          (order?.bookingId && ids.bookingId === order.bookingId) ||
          (customer && sameContact(guest, customer)) ||
          (text.length >= 2 && (matches(text, guest) || sameContact(guest, { emailNormalized: text.includes("@") ? text.toLowerCase() : undefined }) || ids.reference.toLowerCase() === text.toLowerCase()));
        const onOrder = (target: Source) => {
          const other = charging(target);
          return other ? { _id: other._id, title: orderTitle(other.orderNumber) } : null;
        };
        const rows: Attachable[] = [];
        for (const b of state.bookings) {
          if (!b.paid && wanted(b.guest, { bookingId: b.id, reference: b.reference })) {
            rows.push({ kind: "booking", id: b.id, name: b.name, detail: bookingDetail(b), guestName: b.guest.name, price: chargePrice(b), currency: "THB", deposit: b.deposit, unavailableReason: b.checkoutInProgress ? ONLINE_CHECKOUT : null, onOrder: onOrder({ bookingId: b.id }) });
          }
        }
        for (const a of state.appointments) {
          if (!a.paid && a.status !== "no_show" && a.status !== "cancelled" && wanted(a.guest, { bookingId: a.bookingId, reference: a.reference })) {
            rows.push({ kind: "appointment", id: a.appointmentId, name: a.name, detail: a.detail, guestName: a.guest.name, price: a.price, currency: "THB", deposit: 0, unavailableReason: null, onOrder: onOrder({ appointmentId: a.appointmentId }) });
          }
        }
        return rows;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      }, [orderId, text, v]);
    },
    useAttachLookupStatus: () => ({ complete: true }),
    useBusinessName: () => "Auralis Cove Retreat",
    useActions: () => actions,
  };
}
