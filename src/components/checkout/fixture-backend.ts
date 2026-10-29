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
  round2,
} from "convex/lib/billMath";
import { useMemo, useSyncExternalStore } from "react";
import type { Attachable, BillView, Catalog, CheckoutActions, CheckoutBackend, Guest, OpenBill } from "./backend";

/**
 * In-memory checkout for the dev preview (/dev/checkout-preview): sample catalog, a guest with a
 * booking that has a Stripe deposit, and a held bill. Mirrors the rules in convex/pos.ts closely
 * enough to click through every flow; it is not a second source of truth.
 */

const ACTOR = "preview@example.com";
const ATTACHED_PRICE = "A stay is charged at its booked price. Change the price on the booking itself, then attach it again.";
const LATENCY_MS = 150;

type Bill = Doc<"bills">;
type Line = Doc<"billLines">;
type FixtureBooking = { id: Id<"bookings">; guest: Guest; name: string; detail: string; price: number; deposit: number; paid: boolean };
type FixtureAppointment = FixtureBooking & { appointmentId: Id<"serviceAppointments">; serviceId: Id<"services">; staffId: Id<"staff">; start: number };

const fid = <T extends TableNames>(prefix: string, n: number) => `fx${prefix}${String(n).padStart(6, "0")}` as Id<T>;
const staffId = (n: number) => fid<"staff">("staff", n);
const serviceId = (n: number) => fid<"services">("svc", n);
const propertyId = (n: number) => fid<"properties">("villa", n);

const STAFF = ["Nok", "Ploy", "Mali", "Dao"].map((name, i) => ({ _id: staffId(i + 1), name, color: ["#0f766e", "#b45309", "#7c3aed", "#be123c"][i] }));
const SERVICES = [
  ["Thai massage 60", "Massage", 60, 1200, [1, 2, 3], "Traditional stretching and acupressure."],
  ["Thai massage 90", "Massage", 90, 1600, [1, 2], "The full-length traditional massage."],
  ["Aroma oil massage 90", "Massage", 90, 1800, [2, 3], "Warm oil with lemongrass or jasmine."],
  ["Four-hand massage 60", "Massage", 60, 2800, [1, 2, 3, 4], "Two therapists in sync."],
  ["Hot stone 60", "Body", 60, 1500, [3, 4], "Basalt stones and slow strokes."],
  ["Coconut body scrub 45", "Body", 45, 1100, [4], "Fresh coconut and sea salt."],
  ["Foot spa 45", "Feet & hands", 45, 600, [1, 2, 3, 4], "Soak, scrub and foot massage."],
  ["Reflexology 60", "Feet & hands", 60, 900, [1, 4], "Pressure-point foot massage."],
] as const;

const CATALOG: Catalog = {
  services: SERVICES.map(([name, category, durationMin, price, staff, description], i) => ({
    _id: serviceId(i + 1), name, category, description, durationMin, price, currency: "THB", staffIds: staff.map(staffId),
  })),
  rooms: [
    ["Lagoon Pool Villa", "Private pool on the lagoon", 12000, 6],
    ["Garden Villa", "Two bedrooms in the garden", 8500, 4],
    ["Sunrise Suite", "Sea-view suite", 6200, 2],
  ].map(([name, tagline, price, maxGuests], i) => ({
    _id: propertyId(i + 1), name: name as string, tagline: tagline as string, price: price as number, currency: "THB", maxGuests: maxGuests as number,
  })),
  extras: [
    { name: "Airport transfer", price: 1200, category: "Transport" },
    { name: "Breakfast basket", price: 450, category: "Food & drink" },
    { name: "Coconut water", price: 90, category: "Food & drink" },
    { name: "Late checkout", price: 1500, category: "Stay" },
    { name: "Laundry bag", price: 300, category: "Stay" },
  ],
  staff: STAFF,
  frequent: [`service:${serviceId(1)}`, `service:${serviceId(7)}`, "extra:Breakfast basket", `room:${propertyId(2)}`, `service:${serviceId(5)}`],
};

const ANNA: Guest = { name: "Anna Schmidt", phone: "+49 151 2345 6789", email: "anna@example.com" };
const SOMCHAI: Guest = { name: "Somchai Prasert", phone: "+66 81 555 0101" };
const GUESTS: Guest[] = [ANNA, SOMCHAI, { name: "Mia Tanaka", phone: "+81 90 1234 5678" }];

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
    { id: fid("bkg", 1), guest: ANNA, name: "Stay · Lagoon Pool Villa", detail: "3 nights · CONF-2026-A1B2C3", price: 36000, deposit: 10000, paid: false },
  ];
  const appointments: FixtureAppointment[] = [
    { id: fid("bkg", 0), appointmentId: fid("appt", 1), guest: ANNA, serviceId: serviceId(5), staffId: staffId(3), start: todayAt(16), name: "Hot stone 60", detail: "", price: 1500, deposit: 0, paid: false },
    { id: fid("bkg", 0), appointmentId: fid("appt", 2), guest: SOMCHAI, serviceId: serviceId(2), staffId: staffId(1), start: todayAt(11), name: "Thai massage 90", detail: "", price: 1600, deposit: 0, paid: false },
  ];
  for (const a of appointments) a.detail = `Today ${time(a.start)} · SVC-${a.appointmentId.slice(-4)}`;

  const heldBillId = fid<"bills">("bill", 1);
  const held: Bill = {
    _id: heldBillId, _creationTime: now - 3_600_000, status: "held", walkInNumber: 12, currency: "THB", itemCount: 3, total: 780,
    hasItems: true, revision: 1, createdBy: ACTOR, createdAt: now - 3_600_000, updatedAt: now - 1_800_000,
  };
  const heldLines: Line[] = [
    { _id: fid("line", 1), _creationTime: now, billId: heldBillId, kind: "service", serviceId: serviceId(7), name: "Foot spa 45", detail: "45 min", unitPrice: 600, currency: "THB", qty: 1, staffId: staffId(2), createdAt: now },
    { _id: fid("line", 2), _creationTime: now, billId: heldBillId, kind: "extra", name: "Coconut water", unitPrice: 90, currency: "THB", qty: 2, createdAt: now },
  ];
  return {
    bills: new Map<Id<"bills">, Bill>([[heldBillId, held]]),
    lines: heldLines,
    payments: [] as Doc<"billPayments">[],
    audit: [] as Doc<"billAudit">[],
    counters: new Map([["walkin", 12], ["receipt", 141]]),
    bookings,
    appointments,
    seq: 10,
  };
}

export function createFixtureBackend(): CheckoutBackend {
  const state = createState();
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
  const label = (bill: Bill) => bill.guestName || `Walk-in #${bill.walkInNumber}`;
  const linesOf = (billId: Id<"bills">) => state.lines.filter((line) => line.billId === billId);
  const isOpen = (bill: Bill) => bill.status === "draft" || bill.status === "held";
  const patchBill = (billId: Id<"bills">, patch: Partial<Bill>) => state.bills.set(billId, { ...state.bills.get(billId)!, ...patch });
  const patchLine = (lineId: Id<"billLines">, patch: Partial<Line>) => {
    state.lines = state.lines.map((line) => (line._id === lineId ? { ...line, ...patch } : line));
  };
  const refresh = (billId: Id<"bills">) => {
    const lines = linesOf(billId);
    const totals = billTotals(lines);
    assertBillSize(totals);
    const revision = state.bills.get(billId)!.revision + 1;
    patchBill(billId, { itemCount: lines.reduce((n, l) => n + l.qty, 0), total: totals.total, hasItems: lines.length > 0, revision, updatedAt: Date.now() });
  };
  const audit = (entry: Omit<Doc<"billAudit">, "_id" | "_creationTime" | "at" | "actor">) =>
    state.audit.push({ _id: nextId("audit"), _creationTime: Date.now(), at: Date.now(), actor: ACTOR, ...entry });

  const editableBill = (billId?: Id<"bills">): Bill => {
    const now = Date.now();
    if (!billId) {
      const bill: Bill = {
        _id: nextId("bill"), _creationTime: now, status: "draft", walkInNumber: nextNumber("walkin"), currency: "THB",
        itemCount: 0, total: 0, hasItems: false, revision: 0, createdBy: ACTOR, createdAt: now, updatedAt: now,
      };
      state.bills.set(bill._id, bill);
      return bill;
    }
    const bill = state.bills.get(billId);
    if (!bill) throw new Error("Bill not found");
    if (!isOpen(bill)) throw new Error("This bill is already paid");
    if (bill.status === "held") patchBill(bill._id, { status: "draft" });
    return state.bills.get(billId)!;
  };
  const editableLine = (lineId: Id<"billLines">) => {
    const line = state.lines.find((l) => l._id === lineId);
    if (!line) throw new Error("Item not found");
    return { line, bill: editableBill(line.billId) };
  };
  const addLine = (billId: Id<"bills">, line: Omit<Line, "_id" | "_creationTime" | "billId" | "createdAt">) => {
    const row: Line = { _id: nextId("line"), _creationTime: Date.now(), billId, createdAt: Date.now(), ...line };
    state.lines.push(row);
    return row._id;
  };
  const openBillWith = (target: { bookingId?: string; appointmentId?: string }) => {
    const line = state.lines.find((l) =>
      (target.bookingId ? l.bookingId === target.bookingId : l.appointmentId === target.appointmentId) && isOpen(state.bills.get(l.billId)!));
    return line ? state.bills.get(line.billId)! : null;
  };
  const attachTo = (bill: Bill, target: { bookingId?: Id<"bookings">; appointmentId?: Id<"serviceAppointments"> }) => {
    const booking = state.bookings.find((b) => b.id === target.bookingId);
    const appointment = state.appointments.find((a) => a.appointmentId === target.appointmentId);
    const item = booking ?? appointment;
    if (!item) throw new Error("Booking not found");
    if (item.paid) throw new Error("This booking has nothing left to pay");
    const other = openBillWith(target);
    if (other) throw new Error(other._id === bill._id ? "This booking is already on the bill" : `This booking is already on ${label(other)}'s bill`);
    if (booking) {
      addLine(bill._id, { kind: "booking", bookingId: booking.id, name: booking.name, detail: booking.detail, unitPrice: booking.price, currency: "THB", qty: 1, deposit: booking.deposit });
    } else if (appointment) {
      addLine(bill._id, {
        kind: "appointment", appointmentId: appointment.appointmentId, serviceId: appointment.serviceId, name: appointment.name,
        detail: appointment.detail, unitPrice: appointment.price, currency: "THB", qty: 1, staffId: appointment.staffId, startAt: appointment.start,
      });
    }
    if (!state.bills.get(bill._id)!.guestName) patchBill(bill._id, { guestName: item.guest.name, guestPhone: item.guest.phone, guestEmail: item.guest.email });
    refresh(bill._id);
  };

  /** Runs a write after a short delay, like a network round trip, then notifies readers. Like a mutation, a write that throws leaves nothing behind. */
  const later = <T>(write: () => T) =>
    new Promise<T>((resolve, reject) =>
      setTimeout(() => {
        const saved = { bills: new Map(state.bills), lines: [...state.lines], counters: new Map(state.counters) };
        try {
          const result = write();
          version++;
          listeners.forEach((listener) => listener());
          resolve(result);
        } catch (error) {
          Object.assign(state, saved);
          reject(error);
        }
      }, LATENCY_MS),
    );

  const actions: CheckoutActions = {
    openFor: (args) => later(() => {
      const existing = openBillWith(args);
      if (existing) return { billId: existing._id };
      const bill = editableBill();
      attachTo(bill, args);
      return { billId: bill._id };
    }),
    addItem: ({ billId, item }) => later(() => {
      const bill = editableBill(billId);
      let line: Omit<Line, "_id" | "_creationTime" | "billId" | "createdAt">;
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
        ? linesOf(bill._id).find((l) => l.kind === line.kind && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
            (line.kind === "room" ? l.propertyId === line.propertyId : l.name === line.name))
        : undefined;
      const lineId = same && same.qty < MAX_QTY ? (patchLine(same._id, { qty: same.qty + 1 }), same._id) : addLine(bill._id, line);
      refresh(bill._id);
      return { billId: bill._id, lineId };
    }),
    attach: ({ billId, ...target }) => later(() => {
      const bill = editableBill(billId);
      attachTo(bill, target);
      return { billId: bill._id };
    }),
    updateLine: ({ lineId, staffId: staff, startAt, qtyChange, discount }) => later(() => {
      const { line, bill } = editableLine(lineId);
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
      refresh(bill._id);
      return null;
    }),
    overrideLinePrice: ({ lineId, price, note }) => later(() => {
      const { line, bill } = editableLine(lineId);
      if (line.kind === "booking" && price !== null) throw new Error(ATTACHED_PRICE);
      const fromPrice = line.priceOverride?.price ?? line.unitPrice;
      if (price === null) {
        if (!line.priceOverride) return null;
        patchLine(line._id, { priceOverride: undefined });
        audit({ billId: bill._id, lineId, kind: "price_override", fromPrice, toPrice: line.unitPrice, note: note.trim() || undefined });
      } else {
        const clean = assertPriceOverride(price, note);
        patchLine(line._id, { priceOverride: { price: round2(price), note: clean, by: ACTOR, at: Date.now() } });
        audit({ billId: bill._id, lineId, kind: "price_override", fromPrice, toPrice: round2(price), note: clean });
      }
      refresh(bill._id);
      return null;
    }),
    removeLine: ({ lineId }) => later(() => {
      const { bill } = editableLine(lineId);
      state.lines = state.lines.filter((l) => l._id !== lineId);
      refresh(bill._id);
      return null;
    }),
    setCustomer: ({ billId, guest }) => later(() => {
      const bill = editableBill(billId);
      if (guest && !guest.name.trim()) throw new Error("Enter the guest name");
      patchBill(bill._id, { guestName: guest?.name.trim(), guestPhone: guest?.phone, guestEmail: guest?.email, revision: bill.revision + 1, updatedAt: Date.now() });
      return { billId: bill._id };
    }),
    holdBill: ({ billId }) => later(() => {
      const bill = editableBill(billId);
      if (bill.itemCount === 0) throw new Error("Add an item before holding the bill");
      patchBill(billId, { status: "held", updatedAt: Date.now() });
      return null;
    }),
    clearBill: ({ billId }) => later(() => {
      editableBill(billId);
      state.lines = state.lines.filter((l) => l.billId !== billId);
      patchBill(billId, { guestName: undefined, guestPhone: undefined, guestEmail: undefined });
      audit({ billId, kind: "cleared" });
      refresh(billId);
      return null;
    }),
    settleBill: ({ billId, idempotencyKey, expectedDue, expectedRevision, tenders }) => later(() => {
      const bill = state.bills.get(billId);
      if (!bill) throw new Error("Bill not found");
      if (!isOpen(bill)) {
        if (bill.settleKey === idempotencyKey && bill.receiptNumber !== undefined) return { receiptNumber: bill.receiptNumber, replayed: true };
        throw new Error("This bill is already paid");
      }
      const lines = linesOf(billId);
      if (!lines.length) throw new Error("Add an item first");
      const totals = billTotals(lines);
      if (totals.due !== round2(expectedDue) || bill.revision !== expectedRevision) throw new Error("The bill changed. Check the total and pay again.");
      assertTenders(tenders, totals.due);
      for (const line of lines) {
        const item = state.bookings.find((b) => b.id === line.bookingId) ?? state.appointments.find((a) => a.appointmentId === line.appointmentId);
        if (item) item.paid = true;
      }
      const now = Date.now();
      for (const tender of tenders) {
        state.payments.push({ _id: nextId("pay"), _creationTime: now, billId, ...tender, idempotencyKey, createdBy: ACTOR, createdAt: now });
      }
      const receiptNumber = nextNumber("receipt");
      patchBill(billId, { status: "paid", receiptNumber, settleKey: idempotencyKey, total: totals.total, paidAt: now, paidBy: ACTOR, updatedAt: now });
      audit({ billId, kind: "paid", toPrice: totals.due });
      return { receiptNumber, replayed: false };
    }),
    voidBill: ({ billId, reason }) => later(() => {
      const bill = state.bills.get(billId);
      if (!reason.trim()) throw new Error("Give a reason for the void");
      if (bill?.status !== "paid") throw new Error("Only a paid bill can be voided");
      patchBill(billId, { status: "void", voidedAt: Date.now(), voidedBy: ACTOR, voidReason: reason.trim(), updatedAt: Date.now() });
      audit({ billId, kind: "void", note: reason.trim() });
      return null;
    }),
  };

  const billView = (billId: Id<"bills">): BillView | null => {
    const bill = state.bills.get(billId);
    if (!bill) return null;
    const lines = linesOf(billId);
    return {
      bill: { ...bill, label: label(bill) },
      lines: lines.map((line) => ({ ...line, net: lineNet(line), staffName: line.staffId ? STAFF.find((s) => s._id === line.staffId)?.name : undefined })),
      payments: state.payments.filter((p) => p.billId === billId),
      audit: state.audit.filter((a) => a.billId === billId).reverse(),
      totals: billTotals(lines),
    };
  };
  const matches = (guest: Guest, other: Guest) =>
    (guest.phone && other.phone && guest.phone.replace(/\D/g, "") === other.phone.replace(/\D/g, "")) ||
    guest.name.trim().toLowerCase() === other.name.trim().toLowerCase();

  return {
    useCatalog: () => CATALOG,
    useBill: (billId) => {
      const v = useVersion();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      return useMemo(() => (billId ? billView(billId) : null), [billId, v]);
    },
    useOpenBills: (): OpenBill[] => {
      useVersion();
      return [...state.bills.values()]
        .filter((bill) => isOpen(bill) && bill.itemCount > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((bill) => ({ _id: bill._id, status: bill.status, label: label(bill), itemCount: bill.itemCount, total: bill.total, currency: bill.currency, updatedAt: bill.updatedAt }));
    },
    useNextWalkIn: () => {
      useVersion();
      return (state.counters.get("walkin") ?? 0) + 1;
    },
    useGuestSearch: (query) => {
      const text = query.trim().toLowerCase();
      const digits = text.replace(/\D/g, "");
      return useMemo(
        () => (text.length < 2 ? [] : GUESTS.filter((g) => g.name.toLowerCase().includes(text) || (digits.length >= 3 && (g.phone ?? "").replace(/\D/g, "").includes(digits)))),
        [text, digits],
      );
    },
    useAttachable: (guest) => {
      const v = useVersion();
      return useMemo<Attachable[] | undefined>(() => {
        if (!guest) return undefined;
        const rows: Attachable[] = [];
        for (const b of state.bookings) {
          if (!b.paid && matches(guest, b.guest)) rows.push({ kind: "booking", id: b.id, name: b.name, detail: b.detail, price: b.price, currency: "THB", deposit: b.deposit, onBill: openBillWith({ bookingId: b.id })?._id ?? null });
        }
        for (const a of state.appointments) {
          if (!a.paid && matches(guest, a.guest)) rows.push({ kind: "appointment", id: a.appointmentId, name: a.name, detail: a.detail, price: a.price, currency: "THB", deposit: 0, onBill: openBillWith({ appointmentId: a.appointmentId })?._id ?? null });
        }
        return rows;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is the store version
      }, [guest, v]);
    },
    useBusinessName: () => "Auralis Cove Retreat",
    useActions: () => actions,
  };
}
