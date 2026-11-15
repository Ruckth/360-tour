// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { resortTodayIso } from './shared/time';
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup(now: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("properties", {
      slug: "villa", name: "Villa", tagline: "", description: "", pricePerNight: 10000, currency: "THB", maxGuests: 4,
      bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: "active",
    });
  });
  const book = (checkIn: string, checkOut: string) => t.mutation(api.bookings.bookings.create, {
    propertySlug: "villa", guestName: "Guest", guestEmail: "guest@example.com", guestPhone: "+66911111111", checkIn, checkOut, guests: 2,
  });
  return { t, book, admin: t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin" }) };
}

describe("public booking uses the resort day (Asia/Bangkok)", () => {
  it("derives today from UTC+7", () => {
    expect(resortTodayIso(Date.parse("2030-01-10T16:59:59Z"))).toBe("2030-01-10");
    expect(resortTodayIso(Date.parse("2030-01-10T17:00:00Z"))).toBe("2030-01-11");
  });

  it("still accepts today one second before Bangkok midnight", async () => {
    const { book } = await setup("2030-01-10T16:59:59Z");
    await expect(book("2030-01-10", "2030-01-11")).resolves.toMatchObject({ bookingId: expect.any(String) });
  });

  it("rejects the previous Bangkok day after midnight, even while the UTC date is unchanged", async () => {
    const { book } = await setup("2030-01-10T18:00:00Z");
    await expect(book("2030-01-10", "2030-01-11")).rejects.toThrow("Check-in date cannot be in the past");
    await expect(book("2030-01-11", "2030-01-12")).resolves.toMatchObject({ bookingId: expect.any(String) });
  });

  it("keeps historical admin entry", async () => {
    const { admin } = await setup("2030-01-10T18:00:00Z");
    await expect(admin.mutation(api.bookings.commands.createBooking.createBooking, {
      propertySlug: "villa", guestName: "Past", guestPhone: "66911111111", checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 2,
    })).resolves.toBeTruthy();
  });
});
