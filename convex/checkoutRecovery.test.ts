import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin" });
  return { t, admin };
}
beforeEach(() => vi.stubEnv("ADMIN_EMAILS", "admin@example.com"));
afterEach(() => vi.unstubAllEnvs());

describe("customer phone validation", () => {
  it.each(["not-a-phone", "call0812345678", "abc+66812345678", "0812345678abc"])("rejects supplied non-phone text %s on create", async (phone) => {
    const { admin } = setup();
    await expect(admin.mutation(api.customers.createCustomer, { name: "Payer", phone })).rejects.toThrow(/valid phone/i);
  });

  it("rejects a supplied non-phone on update without changing the saved profile", async () => {
    const { admin } = setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: "Payer", phone: "0812345678" });
    await expect(admin.mutation(api.customers.updateCustomer, { customerId, name: "Payer", phone: "not-a-phone" })).rejects.toThrow(/valid phone/i);
    expect(await admin.query(api.customers.getCustomer, { customerId })).toMatchObject({ phone: "0812345678" });
  });

  it.each([undefined, "", "  ", "081-234-5678", "812345678", "+66 81 234 5678", "66812345678", "66-81-234-5678", "44 7700 900123", "+44 7700 900123", "0044 7700 900123", "+1 (202) 555-0123"])("allows optional and supported local/international phone %s", async (phone) => {
    const { admin } = setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: "Payer", phone });
    const saved = await admin.query(api.customers.getCustomer, { customerId });
    expect(saved?.name).toBe("Payer");
    expect(saved?.phone).toBe(phone?.trim() || undefined);
  });

  it("allows unrelated updates with an unchanged legacy phone, correction, and removal", async () => {
    const { t, admin } = setup();
    const customerId = await t.run(ctx => ctx.db.insert("customers", {
      name: "Legacy payer", phone: "old contact note", createdBy: "admin@example.com", createdAt: 1, updatedAt: 1,
    }));
    await admin.mutation(api.customers.updateCustomer, { customerId, name: "Renamed payer", phone: "old contact note", notes: "Updated notes" });
    expect(await admin.query(api.customers.getCustomer, { customerId })).toMatchObject({ name: "Renamed payer", phone: "old contact note", notes: "Updated notes" });
    await admin.mutation(api.customers.updateCustomer, { customerId, name: "Renamed payer", phone: "+44 7700 900123" });
    await admin.mutation(api.customers.updateCustomer, { customerId, name: "Renamed payer", phone: "" });
    expect((await admin.query(api.customers.getCustomer, { customerId }))?.phone).toBeUndefined();
  });
});

describe("checkout source boundaries", () => {
  it.each(["aaaaaaaa", "bbbbbbbb", "bad!"])("returns a recoverable missing order for malformed link %s", async (orderId) => {
    const { admin } = setup();
    await expect(admin.query(api.pos.getOrder, { orderId })).resolves.toBeNull();
  });

  it("opens valid order IDs and safely handles missing and wrong-table IDs", async () => {
    const { t, admin } = setup();
    const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: "extra", name: "Water", price: 10000 } });
    expect(await admin.query(api.pos.getOrder, { orderId })).toMatchObject({ order: { _id: orderId }, lines: [{ name: "Water" }] });
    const customerId = await admin.mutation(api.customers.createCustomer, { name: "Payer" });
    await expect(admin.query(api.pos.getOrder, { orderId: customerId })).resolves.toBeNull();
    await t.run(ctx => ctx.db.delete(orderId));
    await expect(admin.query(api.pos.getOrder, { orderId })).resolves.toBeNull();
  });

  it.each(["bookingId", "appointmentId"] as const)("refuses a malformed %s with a readable source error", async (key) => {
    const { admin } = setup();
    await expect(admin.mutation(api.pos.openOrderForLink, { [key]: "aaaaaaaa" })).rejects.toThrow(/(booking|appointment).*not found/i);
  });

  it("opens valid booking and appointment links, reuses their orders, and reports deleted sources", async () => {
    const { t, admin } = setup();
    const staffId = await admin.mutation(api.adminServices.createStaff, {
      name: "Therapist", role: "Therapist", color: "#abc", workingHours: [], breaks: [],
    });
    const serviceId = await admin.mutation(api.adminServices.createService, {
      slug: "massage", name: "Massage", description: "", category: "Massage", durationMin: 60,
      bufferMin: 0, price: 10000, currency: "THB", staffIds: [staffId],
    });
    const { bookingId, appointmentId } = await t.run(async ctx => {
      const propertyId = await ctx.db.insert("properties", {
        slug: "villa", name: "Villa", tagline: "", description: "", pricePerNight: 10000, currency: "THB",
        maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 100, images: [], amenities: [], tourRoomIds: [],
        directDiscountPercent: 0, status: "active",
      });
      const bookingId = await insertFixture(ctx, "bookings", {
        propertyId, guestName: "Guest", guestPhone: "0812345678", checkIn: "2026-11-10", checkOut: "2026-11-11",
        guests: 1, nights: 1, subtotal: 10000, discountAmount: 0, total: 10000, currency: "THB", amountPaid: 0,
        paymentStatus: "pending", status: "confirmed", confirmationCode: "CONF-LINK", createdAt: Date.now(),
      });
      const start = Date.now() + 3_600_000;
      const appointmentId = await insertFixture(ctx, "appointments", {
        serviceId, staffId, start, end: start + 3_600_000, blockedUntil: start + 3_600_000,
        guestName: "Guest", guestPhone: "0812345678", source: "admin", status: "booked", paymentStatus: "unpaid", price: 10000,
        currency: "THB", confirmationCode: "SVC-LINK", accessToken: "test", createdAt: Date.now(),
      });
      return { bookingId, appointmentId };
    });
    const stay = await admin.mutation(api.pos.openOrderForLink, { bookingId });
    expect(await admin.mutation(api.pos.openOrderForLink, { bookingId })).toEqual(stay);
    expect(await admin.query(api.pos.getOrder, stay)).toMatchObject({ source: { kind: "booking", id: bookingId } });
    const service = await admin.mutation(api.pos.openOrderForLink, { appointmentId });
    expect(await admin.mutation(api.pos.openOrderForLink, { appointmentId })).toEqual(service);
    expect(await admin.query(api.pos.getOrder, service)).toMatchObject({ source: { kind: "appointment", id: appointmentId } });
    // No dangling linked order may mask the deleted-source case.
    await t.run(async ctx => {
      await ctx.db.delete(stay.orderId);
      await ctx.db.delete(service.orderId);
      for (const line of await ctx.db.query("orderLines").collect()) await ctx.db.delete(line._id);
      await ctx.db.delete(bookingId);
      await ctx.db.delete(appointmentId);
    });
    await expect(admin.mutation(api.pos.openOrderForLink, { bookingId })).rejects.toThrow("Booking not found");
    await expect(admin.mutation(api.pos.openOrderForLink, { appointmentId })).rejects.toThrow("Appointment not found");
    await expect(admin.mutation(api.pos.openOrderForLink, { bookingId: appointmentId })).rejects.toThrow("Booking not found");
  });

  it("keeps authentication ahead of source lookup", async () => {
    const { t } = setup();
    await expect(t.query(api.pos.getOrder, { orderId: "aaaaaaaa" })).rejects.toThrow(/not authenticated/i);
    await expect(t.mutation(api.pos.openOrderForLink, { bookingId: "aaaaaaaa" })).rejects.toThrow(/not authenticated/i);
  });
});
