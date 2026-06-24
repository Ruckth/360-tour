// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

function authenticatedTest(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin-token" });
}

async function createProperty(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("properties", {
      slug: "pool-villa",
      name: "Pool Villa",
      tagline: "Private stay",
      description: "A private villa for testing.",
      pricePerNight: 8500,
      currency: "THB",
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      area: 180,
      images: [],
      amenities: ["Private Pool", "WiFi"],
      tourRoomIds: [],
      directDiscountPercent: 15,
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
        await ctx.db.insert("bookings", {
          propertyId,
          guestName: `Guest ${index}`,
          guestEmail: `guest-${index}@example.com`,
          guestPhone: "+66000000000",
          checkIn: `2030-01-0${index + 1}`,
          checkOut: `2030-01-0${index + 2}`,
          guests: 2,
          nights: 1,
          subtotal: 8500,
          discountAmount: 0,
          total: 8500,
          currency: "THB",
          paymentStatus: "pending",
          status: "pending",
          createdAt: 1_700_000_000_000 + index,
        });
      }
    });

    const firstPage = await admin.query(api.bookings.listByProperty, {
      propertyId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    const secondPage = await admin.query(api.bookings.listByProperty, {
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

    await t.mutation(api.leads.save, {
      email: "first@example.com",
      source: "chat",
    });
    await t.mutation(api.leads.save, {
      email: "second@example.com",
      source: "tour_completion",
    });
    await t.mutation(api.leads.save, {
      email: "third@example.com",
      source: "booking_abandonment",
    });

    const firstPage = await admin.query(api.leads.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    const secondPage = await admin.query(api.leads.list, {
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });

    expect(firstPage.page.map((lead) => lead.email)).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.page.map((lead) => lead.email)).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);
  });
});
