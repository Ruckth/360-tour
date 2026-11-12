import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authenticatedTest(t: ReturnType<typeof convexTest>) {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  return t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin-token" });
}

afterEach(() => vi.unstubAllEnvs());

async function createProperty(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("properties", {
      slug: "pool-villa",
      name: "Pool Villa",
      tagline: "Private stay",
      description: "A private villa for testing.",
      pricePerNight: 850000,
      currency: "THB",
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      area: 180,
      images: [],
      amenities: ["Private Pool", "WiFi"],
      tourRoomIds: [],
      directDiscountPercent: 1500,
      status: "active",
    });
  });
}

describe("bounded list queries", () => {
  it("paginates bookings by property", async () => {
    const t = convexTest(schema, modules);
    const admin = authenticatedTest(t);
    const propertyId = await createProperty(t);

    await t.run(async (ctx) => {
      for (let index = 0; index < 3; index++) {
        await insertFixture(ctx, "bookings", {
          propertyId,
          guestName: `Guest ${index}`,
          guestEmail: `guest-${index}@example.com`,
          guestPhone: "+66000000000",
          checkIn: `2030-01-0${index + 1}`,
          checkOut: `2030-01-0${index + 2}`,
          guests: 2,
          nights: 1,
          subtotal: 850000,
          discountAmount: 0,
          total: 850000,
          currency: "THB",
          paymentStatus: "pending",
          status: "pending",
          createdAt: 1_700_000_000_000 + index,
        });
      }
    });

    const firstPage = await admin.query(api.bookings.bookings.listByProperty, {
      propertyId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    const secondPage = await admin.query(api.bookings.bookings.listByProperty, {
      propertyId,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });

    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);
  });

  it("paginates leads", async () => {
    const t = convexTest(schema, modules);
    const admin = authenticatedTest(t);

    await t.mutation(api.messaging.leads.save, {
      email: "first@example.com",
      source: "chat",
    });
    await t.mutation(api.messaging.leads.save, {
      email: "second@example.com",
      source: "tour_completion",
    });
    await t.mutation(api.messaging.leads.save, {
      email: "third@example.com",
      source: "booking_abandonment",
    });

    const firstPage = await admin.query(api.messaging.leads.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    const secondPage = await admin.query(api.messaging.leads.list, {
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });

    expect(firstPage.page.map((lead) => lead.email)).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.page.map((lead) => lead.email)).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);
  });
});
