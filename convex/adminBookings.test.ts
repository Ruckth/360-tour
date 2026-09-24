// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
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
  it("rejects signed-in non-admin access to payment changes and guest data", async () => {
    const { t } = await setup();
    const { bookingId } = await t.mutation(api.bookings.create, { ...stay, guestEmail: "guest@example.com" });
    const propertyId = await t.run(async ctx => (await ctx.db.query("properties").first())!._id);
    const visitor = t.withIdentity({ email: "visitor@example.com", tokenIdentifier: "visitor-token" });
    await expect(visitor.mutation(api.bookings.updatePaymentStatus, { bookingId, paymentStatus: "paid" })).rejects.toThrow("Not authorized");
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
});
