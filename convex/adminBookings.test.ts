// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";

function isoInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const checkIn = isoInDays(30);
const checkOut = isoInDays(33);
const stay = {
  propertySlug: "pool-villa",
  guestName: "Rugby",
  guestPhone: "66956823432",
  checkIn,
  checkOut,
  guests: 2,
};

async function setup() {
  vi.stubEnv("ADMIN_EMAILS", adminEmail);
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("properties", {
      slug: "pool-villa",
      name: "Pool Villa",
      tagline: "Private stay",
      description: "A private villa for testing.",
      pricePerNight: 10000,
      currency: "THB",
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      area: 180,
      images: [],
      amenities: [],
      tourRoomIds: [],
      directDiscountPercent: 15,
      status: "active",
    });
  });
  const admin = t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
  return { t, admin };
}

async function bookedDates(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("availability").collect()).filter((a) => a.status === "booked").length,
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("Stripe checkout confirmation", () => {
  it("marks the matched checkout paid + confirmed and blocks the dates", async () => {
    const { t } = await setup();
    const { bookingId, accessToken } = await t.mutation(api.bookings.create, {
      ...stay,
      guestEmail: "guest@example.com",
    });
    await t.mutation(internal.payments.saveCheckoutSession, { bookingId, accessToken, sessionId: "cs_test_1", url: "https://checkout.stripe.com/example", expiresAt: Date.now() + 1000 });
    const amountTotal = await t.run(async ctx => Math.round((await ctx.db.get(bookingId))!.total * 100));
    await t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: "cs_test_1", amountTotal, currency: "thb", paymentIntentId: "pi_test_1" });
    const paid = await t.run(async ctx => await ctx.db.get(bookingId));
    expect(paid).toMatchObject({ paymentStatus: "paid", status: "confirmed", paymentMethod: "stripe" });
    expect(paid?.confirmationCode).toBeTruthy();
    expect(await bookedDates(t)).toBe(3);
  });

  it("rejects a different checkout session", async () => {
    const { t } = await setup();
    const { bookingId } = await t.mutation(api.bookings.create, {
      ...stay,
      guestEmail: "guest@example.com",
    });

    await expect(
      t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: "wrong", amountTotal: 850000, currency: "thb", paymentIntentId: "pi_test_wrong" }),
    ).rejects.toThrow("Checkout session mismatch");
  });
});

describe("admin bookings", () => {
  it("rejects signed-in non-admin access to guest data", async () => {
    const { t } = await setup();
    const { bookingId } = await t.mutation(api.bookings.create, { ...stay, guestEmail: "guest@example.com" });
    const propertyId = await t.run(async ctx => (await ctx.db.query("properties").first())!._id);
    const visitor = t.withIdentity({ email: "visitor@example.com", tokenIdentifier: "visitor-token" });
    await expect(visitor.query(api.bookings.getById, { id: bookingId })).rejects.toThrow("Not authorized");
    await expect(visitor.query(api.bookings.listByProperty, { propertyId, paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("Not authorized");
    await expect(visitor.query(api.leads.list, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("Not authorized");
  });

  it("requires an admin", async () => {
    const { t } = await setup();
    await expect(
      t.query(api.adminBookings.listForAdmin, { from: checkIn, to: checkOut }),
    ).rejects.toThrow();
    await expect(t.mutation(api.adminBookings.createBooking, stay)).rejects.toThrow();
  });

  it("creates, lists, confirms and cancels a booking", async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);

    const inRange = await admin.query(api.adminBookings.listForAdmin, {
      from: isoInDays(31),
      to: isoInDays(60),
    });
    expect(inRange.bookings).toHaveLength(1);
    expect(inRange.bookings[0]).toMatchObject({ source: "admin", status: "pending" });

    const outOfRange = await admin.query(api.adminBookings.listForAdmin, {
      from: checkOut,
      to: isoInDays(60),
    });
    expect(outOfRange.bookings).toHaveLength(0);

    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "confirm" });
    expect(await bookedDates(t)).toBe(3);
    await expect(admin.mutation(api.adminBookings.createBooking, stay)).rejects.toThrow(
      "no longer available",
    );

    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "cancel" });
    expect(await bookedDates(t)).toBe(0);
    await expect(admin.mutation(api.adminBookings.createBooking, stay)).resolves.toBeTruthy();
  });

  it("marks a booking paid", async () => {
    const { admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "markPaid" });

    const { bookings } = await admin.query(api.adminBookings.listForAdmin, { from: checkIn, to: checkOut });
    expect(bookings[0]).toMatchObject({ paymentStatus: "paid", status: "confirmed", paymentMethod: "admin" });
  });

  it("requires a recorded refund before cancelling a paid booking", async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, guestEmail: "guest@example.com" });
    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "markPaid" });
    expect(await bookedDates(t)).toBe(3);

    await expect(admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "cancel" }))
      .rejects.toThrow("Paid booking: record the refund to cancel");
    expect((await t.run(ctx => ctx.db.get(bookingId)))?.status).toBe("confirmed");

    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "cancel", refundRecorded: true });
    const cancelled = await t.run(ctx => ctx.db.get(bookingId));
    expect(cancelled).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
    expect(cancelled?.refundedAt).toEqual(expect.any(Number));
    expect(cancelled?.cancellationEmailQueuedAt).toEqual(expect.any(Number));
    expect(await bookedDates(t)).toBe(0);
  });

  it("rejects draft and archived properties for quotes and admin bookings", async () => {
    const { t, admin } = await setup();
    const propertyId = await t.run(async ctx => (await ctx.db.query("properties").first())!._id);
    for (const status of ["draft", "archived"] as const) {
      await t.run(ctx => ctx.db.patch(propertyId, { status }));
      await expect(t.query(api.bookings.quoteStay, { propertySlug: stay.propertySlug, checkIn, checkOut, guests: 2 }))
        .rejects.toThrow("Property is not available for booking");
      await expect(admin.mutation(api.adminBookings.createBooking, stay))
        .rejects.toThrow("Property is not available for booking");
    }
  });
});

async function propertyIdOf(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => (await ctx.db.query("properties").collect()).find((p) => p.slug === "pool-villa")!._id);
}

async function addVilla(t: ReturnType<typeof convexTest>, slug: string, pricePerNight: number) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("properties", {
      slug, name: slug, tagline: "", description: "", pricePerNight, currency: "THB", maxGuests: 2,
      bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [],
      directDiscountPercent: 0, status: "active",
    }),
  );
}

async function heldNights(t: ReturnType<typeof convexTest>, bookingId: Id<"bookings">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("availability").collect()).filter((a) => a.bookingId === bookingId).map((a) => a.date).sort(),
  );
}

describe("create as confirmed", () => {
  it("holds the dates immediately", async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe("confirmed");
    expect(await heldNights(t, bookingId)).toHaveLength(3);
  });

  it("exempts admin-created pending bookings from the 24h expiry", async () => {
    const { t, admin } = await setup();
    const adminBooking = await admin.mutation(api.adminBookings.createBooking, stay);
    const { bookingId: webBooking } = await t.mutation(api.bookings.create, {
      ...stay, checkIn: isoInDays(40), checkOut: isoInDays(42), guestEmail: "guest@example.com",
    });
    const old = Date.now() - 25 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.patch(adminBooking, { createdAt: old });
      await ctx.db.patch(webBooking, { createdAt: old });
    });
    expect(await t.mutation(internal.crons.expirePending, {})).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(adminBooking)))?.status).toBe("pending");
    expect((await t.run((ctx) => ctx.db.get(webBooking)))?.status).toBe("cancelled");
  });
});

describe("editBooking", () => {
  const edit = (bookingId: Id<"bookings">, propertyId: Id<"properties">, overrides: Partial<typeof stay & { guestEmail: string }> = {}) => {
    const { checkIn, checkOut, guests, guestName, guestPhone, guestEmail } = { ...stay, guestEmail: "guest@example.com", ...overrides };
    return { bookingId, propertyId, checkIn, checkOut, guests, guestName, guestPhone, guestEmail };
  };

  it("moves the held dates and recomputes the price", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    await admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId, { checkIn: isoInDays(50), checkOut: isoInDays(54), guestName: "Rugby B" }));
    // 4 nights x 10,000 with the 15% direct discount.
    expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({
      checkIn: isoInDays(50), checkOut: isoInDays(54), nights: 4, subtotal: 40000, discountAmount: 6000, total: 34000, guestName: "Rugby B",
    });
    expect(await heldNights(t, bookingId)).toEqual([isoInDays(50), isoInDays(51), isoInDays(52), isoInDays(53)]);
    const scheduled = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((job) => job.name));
    expect(scheduled.some((name) => name.includes("sendBookingUpdated"))).toBe(true);
    // The old dates are free again.
    await expect(admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true })).resolves.toBeTruthy();
  });

  it("does not reprice guest-detail-only edits", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await t.run((ctx) => ctx.db.patch(propertyId, { pricePerNight: 99999 }));
    await admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId, { guestPhone: "+66 1" }));
    expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ total: 25500, guestPhone: "+66 1" });
  });

  it("moves a booking to another villa", async () => {
    const { t, admin } = await setup();
    const other = await addVilla(t, "garden-villa", 5000);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    await admin.mutation(api.adminBookings.editBooking, edit(bookingId, other));
    expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ propertyId: other, total: 15000 });
    const rows = await t.run(async (ctx) => (await ctx.db.query("availability").collect()).filter((a) => a.bookingId === bookingId));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.propertyId === other)).toBe(true);
  });

  it("refuses overlaps with other bookings and blocks but not with itself", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const first = await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    const second = await admin.mutation(api.adminBookings.createBooking, { ...stay, checkIn: checkOut, checkOut: isoInDays(36), confirmed: true });
    // Shifting by one night only overlaps its own nights.
    await admin.mutation(api.adminBookings.editBooking, edit(second, propertyId, { checkIn: isoInDays(34), checkOut: isoInDays(37) }));
    await expect(admin.mutation(api.adminBookings.editBooking, edit(second, propertyId, { checkIn: isoInDays(32), checkOut: isoInDays(35) })))
      .rejects.toThrow("no longer available");
    await admin.mutation(api.adminBookings.addDateBlock, { propertyId, start: isoInDays(40), end: isoInDays(42), reason: "Owner stay" });
    await expect(admin.mutation(api.adminBookings.editBooking, edit(first, propertyId, { checkIn: isoInDays(39), checkOut: isoInDays(41) })))
      .rejects.toThrow("blocked");
    // Failed edits keep the original nights held.
    expect(await heldNights(t, first)).toEqual([isoInDays(30), isoInDays(31), isoInDays(32)]);
  });

  it("enforces capacity and active villas", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await expect(admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId, { guests: 9 }))).rejects.toThrow("max capacity");
    const draft = await addVilla(t, "draft-villa", 100);
    await t.run((ctx) => ctx.db.patch(draft, { status: "draft" }));
    await expect(admin.mutation(api.adminBookings.editBooking, edit(bookingId, draft))).rejects.toThrow("not available");
  });

  it("keeps the amount paid on paid bookings so the balance shows", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "markPaid" });
    await admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId, { checkOut: isoInDays(34) }));
    const detail = await admin.query(api.adminBookings.getForAdmin, { bookingId });
    expect(detail).toMatchObject({ paymentStatus: "paid", total: 34000, amountPaid: 25500 });
    expect(detail?.accessToken).toBeUndefined();
    expect(await heldNights(t, bookingId)).toHaveLength(4);
  });

  it("refuses edits while a Stripe checkout is live and clears a stale one", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const { bookingId, accessToken } = await t.mutation(api.bookings.create, { ...stay, guestEmail: "guest@example.com" });
    await t.mutation(internal.payments.saveCheckoutSession, { bookingId, accessToken, sessionId: "cs_live", url: "https://checkout.stripe.com/x", expiresAt: Date.now() + 60_000 });
    await expect(admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId, { checkOut: isoInDays(34) })))
      .rejects.toThrow("Stripe checkout open");
    await t.run((ctx) => ctx.db.patch(bookingId, { stripeCheckoutExpiresAt: Date.now() - 1 }));
    await admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId, { checkOut: isoInDays(34) }));
    const edited = await t.run((ctx) => ctx.db.get(bookingId));
    expect(edited?.stripeCheckoutSessionId).toBeUndefined();
    expect(edited?.stripeCheckoutUrl).toBeUndefined();
    expect(edited?.total).toBe(34000);
    // A pending booking without a live checkout no longer holds dates.
    expect(await heldNights(t, bookingId)).toHaveLength(0);
  });

  it("is read-only once cancelled", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "cancel" });
    await expect(admin.mutation(api.adminBookings.editBooking, edit(bookingId, propertyId))).rejects.toThrow("read-only");
  });
});

describe("deleteBooking", () => {
  it("deletes unpaid test bookings and clears the chat references", async () => {
    const { t, admin } = await setup();
    const sessionId = await t.run((ctx) => ctx.db.insert("chatSessions", { channel: "web", createdAt: Date.now() }));
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await t.run(async (ctx) => {
      await ctx.db.patch(bookingId, { chatSessionId: sessionId });
      await ctx.db.patch(sessionId, {
        pendingBookingQuote: { ...stay, nights: 3, total: 25500, currency: "THB", createdAt: Date.now(), bookingId },
        pendingCancellation: { bookingId, createdAt: Date.now() },
      });
    });
    await admin.mutation(api.adminBookings.deleteBooking, { bookingId });
    expect(await t.run((ctx) => ctx.db.get(bookingId))).toBeNull();
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.pendingBookingQuote).toBeUndefined();
    expect(session?.pendingCancellation).toBeUndefined();
  });

  it("refuses confirmed, paid and Stripe bookings", async () => {
    const { t, admin } = await setup();
    const confirmed = await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId: confirmed })).rejects.toThrow("Only unpaid");
    await admin.mutation(api.adminBookings.updateBooking, { bookingId: confirmed, action: "markPaid" });
    await admin.mutation(api.adminBookings.updateBooking, { bookingId: confirmed, action: "cancel", refundRecorded: true });
    await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId: confirmed })).rejects.toThrow("Only unpaid");
    const stripe = await admin.mutation(api.adminBookings.createBooking, stay);
    await t.run((ctx) => ctx.db.patch(stripe, { status: "cancelled", stripePaymentIntentId: "pi_1" }));
    await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId: stripe })).rejects.toThrow("Only unpaid");
    const cancelled = await admin.mutation(api.adminBookings.createBooking, stay);
    await admin.mutation(api.adminBookings.updateBooking, { bookingId: cancelled, action: "cancel" });
    await admin.mutation(api.adminBookings.deleteBooking, { bookingId: cancelled });
    expect(await t.run((ctx) => ctx.db.get(cancelled))).toBeNull();
    await expect(t.mutation(api.adminBookings.deleteBooking, { bookingId: stripe })).rejects.toThrow();
  });
});

describe("date blocks", () => {
  it("adds, edits and removes a block that stops bookings", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const blockId = await admin.mutation(api.adminBookings.addDateBlock, { propertyId, start: checkIn, end: checkOut, reason: "  Maintenance " });
    await expect(admin.mutation(api.adminBookings.createBooking, stay)).rejects.toThrow("blocked");
    let listed = await admin.query(api.adminBookings.listForAdmin, { from: checkIn, to: checkOut });
    expect(listed.dateBlocks).toEqual([{ _id: blockId, propertyId, start: checkIn, end: checkOut, reason: "Maintenance" }]);
    expect(listed.blocks).toHaveLength(0);

    await admin.mutation(api.adminBookings.updateDateBlock, { blockId, propertyId, start: checkOut, end: isoInDays(35), reason: "Owner stay" });
    await expect(admin.mutation(api.adminBookings.createBooking, stay)).resolves.toBeTruthy();
    const rows = await t.run(async (ctx) => (await ctx.db.query("availability").collect()).filter((a) => a.dateBlockId === blockId));
    expect(rows.map((r) => r.date).sort()).toEqual([isoInDays(33), isoInDays(34)]);
    expect(rows.every((r) => r.status === "blocked" && r.source === "manual")).toBe(true);

    await admin.mutation(api.adminBookings.removeDateBlock, { blockId });
    listed = await admin.query(api.adminBookings.listForAdmin, { from: checkIn, to: isoInDays(40) });
    expect(listed.dateBlocks).toHaveLength(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("availability").collect()).filter((a) => a.status === "blocked"))).toHaveLength(0);
  });

  it("refuses blocks over confirmed bookings, without a reason or for non-admins", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    await expect(admin.mutation(api.adminBookings.addDateBlock, { propertyId, start: isoInDays(32), end: isoInDays(34), reason: "Owner" }))
      .rejects.toThrow("no longer available");
    await expect(admin.mutation(api.adminBookings.addDateBlock, { propertyId, start: isoInDays(40), end: isoInDays(41), reason: " " }))
      .rejects.toThrow("reason");
    await expect(admin.mutation(api.adminBookings.addDateBlock, { propertyId, start: isoInDays(41), end: isoInDays(40), reason: "x" }))
      .rejects.toThrow();
    await expect(t.mutation(api.adminBookings.addDateBlock, { propertyId, start: isoInDays(40), end: isoInDays(41), reason: "x" }))
      .rejects.toThrow();
  });
});

describe("search, notes and pay link", () => {
  it("finds bookings by name, phone or confirmation code", async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, guestName: "Somchai Jaidee", guestPhone: "+66 81 234 5678" });
    await admin.mutation(api.adminBookings.createBooking, { ...stay, guestName: "Other Guest", guestPhone: "+44 20 0000 0000" });
    // Test ids share a suffix, so give this booking a distinct code.
    await t.run((ctx) => ctx.db.patch(bookingId, { confirmationCode: "CONF-2026-ABC123" }));
    for (const query of ["somchai", "81 234", "2345678", "conf-2026-abc1"]) {
      const results = await admin.query(api.adminBookings.searchBookings, { query });
      expect(results.map((r) => r._id)).toEqual([bookingId]);
    }
    expect(await admin.query(api.adminBookings.searchBookings, { query: "s" })).toEqual([]);
    await expect(t.query(api.adminBookings.searchBookings, { query: "somchai" })).rejects.toThrow();
  });

  it("saves notes and exposes the pay token only while unpaid", async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await admin.mutation(api.adminBookings.updateNotes, { bookingId, notes: "  Late arrival " });
    const token = (await t.run((ctx) => ctx.db.get(bookingId)))!.accessToken;
    expect(await admin.query(api.adminBookings.getForAdmin, { bookingId })).toMatchObject({
      adminNotes: "Late arrival", accessToken: token, propertyName: "Pool Villa",
    });
    await admin.mutation(api.adminBookings.updateNotes, { bookingId, notes: "" });
    expect((await admin.query(api.adminBookings.getForAdmin, { bookingId }))?.adminNotes).toBeUndefined();
    await expect(t.query(api.adminBookings.getForAdmin, { bookingId })).rejects.toThrow();
  });
});
