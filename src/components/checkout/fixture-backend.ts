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
  lineNet,
  orderTitle,
  round2,
} from "convex/lib/billMath";
import { useMemo, useSyncExternalStore } from "react";
import type { Attachable, Catalog, CheckoutActions, CheckoutBackend, Customer, OrderFilter, OrderRow, OrderView } from "./backend";

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
type FixtureBooking = { id: Id<"bookings">; propertyId?: Id<"properties">; guest: Guest; name: string; detail: string; reference: string; price: number; deposit: number; paid: boolean; checkoutInProgress?: boolean };
type FixtureAppointment = Omit<FixtureBooking, "id"> & { appointmentId: Id<"serviceAppointments">; bookingId?: Id<"bookings">; serviceId: Id<"services">; staffId: Id<"staff">; start: number };
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

const ANNA: Guest = { name: "Anna Schmidt", phone: "+49 151 2345 6789", email: "anna@example.com" };
const SOMCHAI: Guest = { name: "Somchai Prasert", phone: "+66 81 555 0101" };
const MIA: Guest = { name: "Mia Tanaka", phone: "+81 90 1234 5678" };

function todayAt(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

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
  for (const a of appointments) a.detail = `Today ${time(a.start)} · ${a.reference}`;

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
    counters: new Map([["order", 1042], ["receipt", 141]]),
    customers,
    bookings,
    appointments,
    seq: 10,
  };
}

export function createFixtureBackend(): CheckoutBackend {
  let state = createState();
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
  const stateOf = (order: Order) => (isOpen(order) ? ("unpaid" as const) : order.status === "paid" ? ("paid" as const) : ("void" as const));
  const patchOrder = (orderId: Id<"bills">, patch: Partial<Order>) => state.orders.set(orderId, { ...state.orders.get(orderId)!, ...patch });
  const patchLine = (lineId: Id<"billLines">, patch: Partial<Line>) => {
    state.lines = state.lines.map((line) => (line._id === lineId ? { ...line, ...patch } : line));
  };
  const refresh = (orderId: Id<"bills">) => {
    const lines = linesOf(orderId);
    const totals = billTotals(lines);
    assertBillSize(totals);
    const revision = state.orders.get(orderId)!.revision + 1;
    patchOrder(orderId, { itemCount: lines.reduce((n, l) => n + l.qty, 0), total: totals.total, due: totals.due, hasItems: lines.length > 0, revision, updatedAt: Date.now() });
  };
  const audit = (entry: Omit<Doc<"billAudit">, "_id" | "_creationTime" | "at" | "actor">) =>
    state.audit.push({ _id: nextId("audit"), _creationTime: Date.now(), at: Date.now(), actor: ACTOR, ...entry });

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
    if (item.paid) throw new Error(`${what} has nothing left to pay`);
    if (booking?.checkoutInProgress) throw new Error(ONLINE_CHECKOUT);
    if (booking) {
      addLine(order._id, { kind: "booking", bookingId: booking.id, name: booking.name, detail: booking.detail, unitPrice: booking.price, currency: "THB", qty: 1, ...(booking.deposit ? { deposit: booking.deposit } : {}) });
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
    refresh(order._id);
  };

  /** Runs a write after a short delay, like a network round trip, then notifies readers. Like a mutation, a write that throws leaves nothing behind. */
  const later = <T>(write: () => T) =>
    new Promise<T>((resolve, reject) =>
      setTimeout(() => {
        const saved = {
          ...state, orders: new Map(state.orders), lines: [...state.lines], counters: new Map(state.counters),
          customers: [...state.customers], payments: [...state.payments], audit: [...state.audit],
          bookings: state.bookings.map((b) => ({ ...b })), appointments: state.appointments.map((a) => ({ ...a })),
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

  const actions: CheckoutActions = {
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
        ? linesOf(order._id).find((l) => l.kind === line.kind && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
            (line.kind === "room" ? l.propertyId === line.propertyId : l.name === line.name))
        : undefined;
      const lineId = same && same.qty < MAX_QTY ? (patchLine(same._id, { qty: same.qty + 1 }), same._id) : addLine(order._id, line);
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
      patchLine(line._id, patch);
      refresh(order._id);
      return null;
    }),
    overrideLinePrice: ({ lineId, price, note }) => later(() => {
      const { line, order } = editableLine(lineId);
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
      const { order } = editableLine(lineId);
      state.lines = state.lines.filter((l) => l._id !== lineId);
      refresh(order._id);
      return null;
    }),
    updateSourceLine: ({ lineId }) => later(() => {
      const { line, order } = editableLine(lineId);
      if (!sourceOf(line)?.paid) return { result: "current" as const };
      state.lines = state.lines.filter((l) => l._id !== lineId);
      audit({ billId: order._id, lineId, kind: "source_removed", fromPrice: line.unitPrice, note: line.name });
      refresh(order._id);
      return { result: "removed" as const };
    }),
    createCustomer: (args) => later(() => {
      const name = args.name.trim();
      if (!name) throw new Error("Enter the customer name");
      const now = Date.now();
      const phone = args.phone?.trim() || undefined;
      const email = args.email?.trim() || undefined;
      const customer: Doc<"customers"> = {
        _id: nextId("cust"), _creationTime: now, name, phone, phoneDigits: phone?.replace(/\D/g, "") || undefined, email,
        emailNormalized: email?.toLowerCase(), createdBy: ACTOR, createdAt: now, updatedAt: now,
      };
      state.customers.push(customer);
      return customer._id;
    }),
    linkCustomer: ({ orderId, customerId }) => later(() => {
      const customer = state.customers.find((c) => c._id === customerId);
      if (!customer) throw new Error("Customer not found");
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
      state.lines = state.lines.filter((l) => l.billId !== orderId);
      audit({ billId: orderId, kind: "cleared" });
      refresh(orderId);
      return null;
    }),
    settleOrder: ({ orderId, idempotencyKey, expectedDue, expectedRevision, tenders }) => later(() => {
      const order = state.orders.get(orderId);
      if (!order) throw new Error("Order not found");
      if (!isOpen(order)) {
        if (order.settleKey === idempotencyKey && order.receiptNumber !== undefined) return { receiptNumber: order.receiptNumber, replayed: true };
        throw new Error(order.status === "void" ? "This order was voided" : "This order is already paid");
      }
      const lines = linesOf(orderId);
      if (!lines.length) throw new Error("Add an item first");
      const totals = billTotals(lines);
      if (totals.due !== round2(expectedDue) || order.revision !== expectedRevision) throw new Error("The order changed. Check the total and pay again.");
      assertTenders(tenders, totals.due);
      for (const line of lines) {
        const item = sourceOf(line);
        if (item?.paid) throw new Error(`${line.name}: this was paid since it was added. Remove it from the order.`);
      }
      for (const line of lines) {
        const item = sourceOf(line);
        if (item && (line.bookingId || line.appointmentId)) item.paid = true;
        if (line.staffId) patchLine(line._id, { staffName: STAFF.find((s) => s._id === line.staffId)?.name });
      }
      const now = Date.now();
      for (const tender of tenders) {
        state.payments.push({ _id: nextId("pay"), _creationTime: now, billId: orderId, ...tender, idempotencyKey, createdBy: ACTOR, createdAt: now });
      }
      const customer = state.customers.find((c) => c._id === order.customerId);
      const receiptNumber = nextNumber("receipt");
      patchOrder(orderId, {
        status: "paid", receiptNumber, settleKey: idempotencyKey, total: totals.total, due: 0, paidAt: now, paidBy: ACTOR, updatedAt: now,
        ...(customer ? { customerSnapshot: { name: customer.name, phone: customer.phone, email: customer.email } } : {}),
      });
      audit({ billId: orderId, kind: "paid", toPrice: totals.due });
      return { receiptNumber, replayed: false };
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

  const card = (customer: Doc<"customers">): Customer => ({ _id: customer._id, name: customer.name, phone: customer.phone, email: customer.email });
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
        sourceIssue: isOpen(order) && sourceOf(line)?.paid && (line.bookingId || line.appointmentId)
          ? { kind: "settled" as const, message: "This was paid since it was added. Remove it from the order." }
          : null,
      })),
      payments: state.payments.filter((p) => p.billId === orderId),
      audit: state.audit.filter((a) => a.billId === orderId).reverse(),
      totals: billTotals(lines),
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
    useCatalog: () => CATALOG,
    useOrder: (orderId) => {
      const v = useVersion();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      return useMemo(() => (orderId ? orderView(orderId) : null), [orderId, v]);
    },
    useOrders: (filter: OrderFilter) => {
      const v = useVersion();
      const results = useMemo(
        () => [...state.orders.values()].filter((o) => o.hasItems && stateOf(o) === filter).sort((a, b) => b.updatedAt - a.updatedAt).map(orderRow),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
        [filter, v],
      );
      return { results, status: "Exhausted" as const, loadMore: () => {} };
    },
    useCustomerSearch: (query) => {
      const v = useVersion();
      const text = query.trim();
      return useMemo(
        () => (text.length < 2 ? [] : state.customers.filter((c) => matches(text, c) || (text.includes("@") && c.emailNormalized === text.toLowerCase())).map(card)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
        [text, v],
      );
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
            rows.push({ kind: "booking", id: b.id, name: b.name, detail: b.detail, guestName: b.guest.name, price: b.price, currency: "THB", deposit: b.deposit, unavailableReason: b.checkoutInProgress ? ONLINE_CHECKOUT : null, onOrder: onOrder({ bookingId: b.id }) });
          }
        }
        for (const a of state.appointments) {
          if (!a.paid && wanted(a.guest, { bookingId: a.bookingId, reference: a.reference })) {
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
