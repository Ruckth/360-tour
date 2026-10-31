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

async function attachCheckout(t: ReturnType<typeof convexTest>, bookingId: Id<'bookings'>, accessToken: string, sessionId: string, expiresAt: number) {
  const { request } = await t.mutation(internal.payments.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
  if (!request) throw new Error('Expected a new checkout request');
  await t.mutation(internal.payments.saveCheckoutSession, {
    bookingId, accessToken, sessionId, url: 'https://checkout.stripe.com/example', expiresAt,
    attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("Stripe checkout confirmation", () => {
  it("marks the matched checkout paid + confirmed and blocks the dates", async () => {
    const { t } = await setup();
    const { bookingId, accessToken } = await t.mutation(api.bookings.create, {
      ...stay,
      guestEmail: "guest@example.com",
    });
    await attachCheckout(t, bookingId, accessToken, 'cs_test_1', Date.now() + 1000);
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

  it('rejects moving a paid booking into a different currency', async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' });
    const usdVilla = await addVilla(t, 'usd-villa', 500);
    await t.run(ctx => ctx.db.patch(usdVilla, { currency: 'USD' }));
    await expect(admin.mutation(api.adminBookings.editBooking, edit(bookingId, usdVilla))).rejects.toThrow('different currency');
    expect((await t.run(ctx => ctx.db.get(bookingId)))?.currency).toBe('THB');
  });

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
    await attachCheckout(t, bookingId, accessToken, 'cs_live', Date.now() + 60_000);
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

  it('keeps bookings with more than 50 service appointments intact', async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await t.run(async ctx => {
      const staffId = await ctx.db.insert('staff', { name: 'Staff', role: 'Spa', color: '#fff', status: 'active', workingHours: [], breaks: [], createdAt: 0, updatedAt: 0 });
      const serviceId = await ctx.db.insert('services', { slug: 'spa', name: 'Spa', description: '', category: 'spa', durationMin: 60, bufferMin: 0, price: 100, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: 0, updatedAt: 0 });
      for (let i = 0; i < 51; i++) await ctx.db.insert('serviceAppointments', { serviceId, staffId, start: i, end: i + 1, blockedUntil: i + 1, guestName: 'Guest', guestPhone: '123', bookingId, source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 100, currency: 'THB', confirmationCode: `SPA${i}`, accessToken: 'test', createdAt: 0 });
    });
    await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId })).rejects.toThrow('more than 50 service appointments');
    expect(await t.run(ctx => ctx.db.get(bookingId))).not.toBeNull();
  });
});

describe("date blocks", () => {

  it('rejects a batch over 1,500 villa nights before writing blocks', async () => {
    const { t, admin } = await setup();
    const villas = [await propertyIdOf(t)];
    for (let i = 0; i < 4; i++) villas.push(await addVilla(t, `villa-${i}`, 5000));
    await expect(admin.mutation(api.adminBookings.addDateBlocks, { propertyIds: villas, start: isoInDays(30), end: isoInDays(331), reason: 'Maintenance' })).rejects.toThrow('fewer villas or a shorter range');
    expect(await t.run(ctx => ctx.db.query('dateBlocks').collect())).toEqual([]);
  });
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

describe("returning guests", () => {
  it("suggests previous guests by phone or email, one entry per guest", async () => {
    const { t, admin } = await setup();
    await admin.mutation(api.adminBookings.createBooking, { ...stay, guestName: "Somchai", guestPhone: "+66 81 234 5678", guestEmail: "som@example.com" });
    await admin.mutation(api.adminBookings.createBooking, { ...stay, checkIn: isoInDays(40), checkOut: isoInDays(42), guestName: "Somchai", guestPhone: "+66 81 234 5678" });
    await admin.mutation(api.adminBookings.createBooking, { ...stay, guestName: "Other", guestPhone: "+44 20 0000 0000" });

    expect(await admin.query(api.adminBookings.findGuests, { phone: "812345678" })).toEqual([
      { guestName: "Somchai", guestPhone: "+66 81 234 5678", guestEmail: "som@example.com", stays: 2, lastCheckIn: isoInDays(40) },
    ]);
    expect(await admin.query(api.adminBookings.findGuests, { phone: "+66 81 234 5678" })).toHaveLength(1);
    expect((await admin.query(api.adminBookings.findGuests, { email: "SOM@exa" }))[0]?.guestName).toBe("Somchai");
    expect(await admin.query(api.adminBookings.findGuests, { phone: "12", email: "so" })).toEqual([]);
    await expect(t.query(api.adminBookings.findGuests, { phone: "81234" })).rejects.toThrow();
  });
});

describe("clean up test bookings", () => {
  it("lists unpaid admin or old bookings and batch deletes them with the delete rules", async () => {
    const { t, admin } = await setup();
    const manual = await admin.mutation(api.adminBookings.createBooking, stay);
    const confirmed = await admin.mutation(api.adminBookings.createBooking, { ...stay, checkIn: isoInDays(50), checkOut: isoInDays(52), confirmed: true });
    const { bookingId: fresh } = await t.mutation(api.bookings.create, { ...stay, guestEmail: "g@example.com", checkIn: isoInDays(60), checkOut: isoInDays(62) });
    const { bookingId: old } = await t.mutation(api.bookings.create, { ...stay, guestEmail: "g@example.com", checkIn: isoInDays(70), checkOut: isoInDays(72) });
    await t.run((ctx) => ctx.db.patch(old, { status: "cancelled", createdAt: Date.now() - 40 * 86_400_000 }));

    const candidates = await admin.query(api.adminBookings.listCleanupCandidates, { olderThanDays: 30 });
    expect(candidates.map((b) => b._id).sort()).toEqual([manual, old].sort());
    expect((await admin.query(api.adminBookings.listCleanupCandidates, { olderThanDays: 0 })).map((b) => b._id)).toContain(fresh);

    const result = await admin.mutation(api.adminBookings.deleteBookings, { bookingIds: [manual, old, confirmed] });
    expect(result.deleted).toBe(2);
    expect(result.skipped).toEqual([{ bookingId: confirmed, reason: "Only unpaid pending or cancelled bookings can be deleted." }]);
    expect(await t.run((ctx) => Promise.all([ctx.db.get(manual), ctx.db.get(old), ctx.db.get(confirmed)]))).toEqual([
      null,
      null,
      expect.objectContaining({ _id: confirmed }),
    ]);
    await expect(t.mutation(api.adminBookings.deleteBookings, { bookingIds: [fresh] })).rejects.toThrow();
    await expect(t.query(api.adminBookings.listCleanupCandidates, { olderThanDays: 30 })).rejects.toThrow();
  });
});

describe("block dates across villas", () => {
  it("blocks every free villa and reports conflicts per villa", async () => {
    const { t, admin } = await setup();
    const pool = await propertyIdOf(t);
    const garden = await addVilla(t, "garden-villa", 5000);
    await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });

    const results = await admin.mutation(api.adminBookings.addDateBlocks, { propertyIds: [pool, garden], start: checkIn, end: checkOut, reason: " Festival " });
    expect(results).toEqual([
      { propertyId: pool, blockId: null, error: "These dates are no longer available. Please choose different dates." },
      { propertyId: garden, blockId: expect.anything(), error: null },
    ]);
    const blocks = await t.run((ctx) => ctx.db.query("dateBlocks").collect());
    expect(blocks).toEqual([expect.objectContaining({ propertyId: garden, reason: "Festival", start: checkIn, end: checkOut })]);

    await expect(admin.mutation(api.adminBookings.addDateBlocks, { propertyIds: [garden], start: isoInDays(40), end: isoInDays(41), reason: " " })).rejects.toThrow("reason");
    await expect(admin.mutation(api.adminBookings.addDateBlocks, { propertyIds: [], start: isoInDays(40), end: isoInDays(41), reason: "x" })).rejects.toThrow("villa");
    await expect(t.mutation(api.adminBookings.addDateBlocks, { propertyIds: [garden], start: isoInDays(40), end: isoInDays(41), reason: "x" })).rejects.toThrow();
  });
});

describe("villa picker photos", () => {
  it("returns the cover photo without sending the full gallery", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
      const property = (await ctx.db.query("properties").first())!;
      await ctx.db.patch(property._id, { images: ["https://example.com/cover.jpg", "https://example.com/bedroom.jpg"] });
    });
    const result = await admin.query(api.adminBookings.listForAdmin, { from: checkIn, to: checkOut });
    expect(result.properties[0].imageUrl).toBe("https://example.com/cover.jpg");
    expect(result.properties[0]).not.toHaveProperty("images");
  });
});

describe("historical admin bookings", () => {
  it.each([
    { label: "historical pending", from: -40, to: -37, confirmed: false },
    { label: "historical confirmed", from: -40, to: -37, confirmed: true },
    { label: "ongoing confirmed", from: -2, to: 2, confirmed: true },
  ])("creates $label with the usual quote and payment behavior", async ({ from, to, confirmed }) => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, {
      ...stay, checkIn: isoInDays(from), checkOut: isoInDays(to), confirmed, guestEmail: "guest@example.com",
    });
    const booking = await t.run(ctx => ctx.db.get(bookingId));
    expect(booking).toMatchObject({
      source: "admin", checkIn: isoInDays(from), checkOut: isoInDays(to), nights: to - from,
      subtotal: (to - from) * 10000, total: (to - from) * 8500,
      status: confirmed ? "confirmed" : "pending", paymentStatus: "pending",
    });
    expect(Boolean(booking?.confirmationEmailsQueuedAt)).toBe(confirmed);
    const order = await t.run(ctx => ctx.db.query("bills")
      .withIndex("by_bookingId_and_status", q => q.eq("bookingId", bookingId).eq("status", "draft"))
      .unique());
    expect(order).toMatchObject({ bookingId, createdBy: adminEmail, hasItems: false, itemCount: 0 });
    expect(await bookedDates(t)).toBe(confirmed ? to - from : 0);
    await t.mutation(internal.crons.expirePending, {});
    expect((await t.run(ctx => ctx.db.get(bookingId)))?.status).toBe(confirmed ? "confirmed" : "pending");
  });

  it("corrects completed paid stays and ongoing check-in, preserving money and holding only the new nights", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, {
      ...stay, checkIn: isoInDays(-10), checkOut: isoInDays(-7), confirmed: true,
    });
    await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: "markPaid" });
    await t.run(ctx => ctx.db.patch(bookingId, { status: "completed" }));
    const edit = { bookingId, propertyId, guestName: stay.guestName, guestPhone: stay.guestPhone, guests: 2 };
    await admin.mutation(api.adminBookings.editBooking, { ...edit, checkIn: isoInDays(-11), checkOut: isoInDays(-7) });
    expect(await t.run(ctx => ctx.db.get(bookingId))).toMatchObject({
      status: "completed", paymentStatus: "paid", amountPaid: 25500, nights: 4, total: 34000,
    });
    expect(await bookedDates(t)).toBe(4);
    await admin.mutation(api.adminBookings.editBooking, { ...edit, checkIn: isoInDays(-2), checkOut: isoInDays(2) });
    const rows = await t.run(ctx => ctx.db.query("availability").collect());
    expect(rows.map(row => row.date).sort()).toEqual([-2, -1, 0, 1].map(isoInDays));
  });

  it.each([
    { checkIn: isoInDays(-3), checkOut: isoInDays(-3), error: "after check-in" },
    { checkIn: isoInDays(-3), checkOut: isoInDays(-4), error: "after check-in" },
    { checkIn: isoInDays(-400), checkOut: isoInDays(-34), error: "365 nights" },
    { checkIn: "2025-02-30", checkOut: "2025-03-02", error: "YYYY-MM-DD" },
    { checkIn: isoInDays(-3), checkOut: isoInDays(-1), guests: 9, error: "max capacity" },
  ])("keeps date/capacity validation for create and edit: $error", async ({ error, ...dates }) => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, stay);
    await expect(admin.mutation(api.adminBookings.createBooking, { ...stay, ...dates })).rejects.toThrow(error);
    await expect(admin.mutation(api.adminBookings.editBooking, {
      bookingId, propertyId, guestName: stay.guestName, guestPhone: stay.guestPhone, guests: 2, ...dates,
    })).rejects.toThrow(error);
  });

  it("refuses historical booking and external-block conflicts atomically, including legacy holds", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const past = { checkIn: "2025-01-30", checkOut: "2025-02-03" };
    const occupied = await admin.mutation(api.adminBookings.createBooking, { ...stay, ...past, confirmed: true });
    // A legacy completed booking without its availability mirror must still conflict.
    await t.run(async ctx => {
      await ctx.db.patch(occupied, { status: "completed" });
      for (const row of await ctx.db.query("availability").collect()) await ctx.db.delete(row._id);
    });
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, confirmed: true });
    const before = await t.run(ctx => ctx.db.get(bookingId));
    await expect(admin.mutation(api.adminBookings.createBooking, { ...stay, ...past })).rejects.toThrow("no longer available");
    const edit = { bookingId, propertyId, guestName: stay.guestName, guestPhone: stay.guestPhone, guests: 2 };
    await expect(admin.mutation(api.adminBookings.editBooking, { ...edit, ...past })).rejects.toThrow("no longer available");
    expect(await t.run(ctx => ctx.db.get(bookingId))).toEqual(before);
    expect(await bookedDates(t)).toBe(3);
    await t.run(ctx => ctx.db.insert("availability", { propertyId, date: "2025-03-01", status: "blocked", source: "airbnb" }));
    const blockedStay = { checkIn: "2025-02-28", checkOut: "2025-03-03" };
    await expect(admin.mutation(api.adminBookings.createBooking, { ...stay, ...blockedStay })).rejects.toThrow("blocked");
    await expect(admin.mutation(api.adminBookings.editBooking, { ...edit, ...blockedStay })).rejects.toThrow("blocked");
    expect(await bookedDates(t)).toBe(3);
  });

  it("requires admin authentication and keeps public create rejecting past dates even for an admin caller", async () => {
    const { t, admin } = await setup();
    const past = { ...stay, checkIn: isoInDays(-3), checkOut: isoInDays(-1) };
    const visitor = t.withIdentity({ email: "guest@example.com", tokenIdentifier: "guest-token" });
    await expect(t.mutation(api.adminBookings.createBooking, past)).rejects.toThrow();
    await expect(visitor.mutation(api.adminBookings.createBooking, past)).rejects.toThrow("Not authorized");
    for (const client of [t, visitor, admin]) {
      await expect(client.mutation(api.bookings.create, { ...past, guestEmail: "guest@example.com" })).rejects.toThrow("in the past");
    }
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, past);
    await expect(visitor.mutation(api.adminBookings.editBooking, {
      bookingId, propertyId, checkIn: isoInDays(-4), checkOut: isoInDays(-1), guests: 2,
      guestName: stay.guestName, guestPhone: stay.guestPhone,
    })).rejects.toThrow("Not authorized");
    const injected = { ...past, guestEmail: "guest@example.com", allowPastCheckIn: true };
    await expect(t.mutation(api.bookings.create, injected)).rejects.toThrow();
  });

  it("reads bounded historical availability with exact booking exclusion and coexisting blocks", async () => {
    const { t, admin } = await setup();
    const propertyId = await propertyIdOf(t);
    const bookingId = await admin.mutation(api.adminBookings.createBooking, {
      ...stay, checkIn: "2025-01-30", checkOut: "2025-02-03", confirmed: true,
    });
    const window = { propertyId, startDate: "2025-02-01", endDate: "2025-02-28" };
    expect(await admin.query(api.availability.getAdminBlockedDates, window)).toEqual(["2025-02-01", "2025-02-02"]);
    expect(await admin.query(api.availability.getAdminBlockedDates, { ...window, excludeBookingId: bookingId })).toEqual([]);
    await t.run(ctx => ctx.db.insert("availability", { propertyId, date: "2025-02-01", status: "blocked", source: "airbnb" }));
    expect(await admin.query(api.availability.getAdminBlockedDates, { ...window, excludeBookingId: bookingId })).toEqual(["2025-02-01"]);
    // Legacy booking remains visible even after all its own availability rows are missing.
    await t.run(async ctx => {
      for (const row of await ctx.db.query("availability").collect()) if (row.bookingId) await ctx.db.delete(row._id);
    });
    expect(await admin.query(api.availability.getAdminBlockedDates, window)).toEqual(["2025-02-01", "2025-02-02"]);
    await expect(t.query(api.availability.getAdminBlockedDates, window)).rejects.toThrow();
    await expect(admin.query(api.availability.getAdminBlockedDates, { ...window, endDate: "2027-02-01" })).rejects.toThrow("366 days");
  });

  it("finds legacy national phone contacts when the country input emits E.164", async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, { ...stay, guestPhone: "0812345678" });
    await t.run(async ctx => {
      await ctx.db.patch(bookingId, { guestPhoneDigits: undefined });
      const booking = (await ctx.db.get(bookingId))!;
      // Put this pre-index national contact outside the recent-booking fallback.
      const { _id, _creationTime, ...fields } = booking;
      void _id; void _creationTime;
      for (let index = 0; index < 1001; index++) {
        await ctx.db.insert("bookings", { ...fields, guestPhone: "+12025550123" });
      }
    });
    expect(await admin.query(api.adminBookings.findGuests, { phone: "+66812345678" })).toEqual([
      expect.objectContaining({ guestPhone: "0812345678", guestName: stay.guestName }),
    ]);
  });
});


describe("international booking phone compatibility", () => {
  it("finds admin stays from a verified WhatsApp number with either international representation only", async () => {
    const { t, admin } = await setup();
    const ids = [];
    for (const guestPhone of ["+66812345678", "66812345678"]) {
      ids.push(await admin.mutation(api.adminBookings.createBooking, { ...stay, guestPhone }));
    }
    // Never infer a country or use partial matches when authorizing chat access.
    await admin.mutation(api.adminBookings.createBooking, { ...stay, guestPhone: "0812345678" });
    await admin.mutation(api.adminBookings.createBooking, { ...stay, guestPhone: "+44812345678" });
    const sessionId = await t.run(ctx => ctx.db.insert("chatSessions", {
      channel: "whatsapp", visitorId: "whatsapp:66812345678", visitorPhone: "66812345678", createdAt: Date.now(),
    }));
    const found = await t.query(internal.bookings.listChatGuestBookings, { sessionId });
    expect(found.map(booking => booking.bookingId).sort()).toEqual(ids.sort());
    await t.run(ctx => ctx.db.patch(sessionId, { channel: "web" }));
    expect(await t.query(internal.bookings.listChatGuestBookings, { sessionId })).toEqual([]);
  });

  it("groups national and international representations in returning guest suggestions", async () => {
    const { admin } = await setup();
    for (const guestPhone of ["0812345678", "66812345678", "+66812345678"]) {
      await admin.mutation(api.adminBookings.createBooking, { ...stay, guestPhone });
    }
    const suggestions = await admin.query(api.adminBookings.findGuests, { phone: "+66812345678" });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].stays).toBe(3);
  });
});
