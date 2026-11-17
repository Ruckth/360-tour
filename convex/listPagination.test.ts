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

describe("bounded list queries", () => {

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
