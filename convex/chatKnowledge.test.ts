// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";

function adminTest(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
}

async function createWebSession(
  t: ReturnType<typeof convexTest>,
  args: { propertyId?: string; propertySlug?: string } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      propertyId: args.propertyId as never,
      propertySlug: args.propertySlug,
      channel: "web",
      visitorId: `web-test-${Date.now()}-${Math.random()}`,
      currentPath: args.propertySlug ? `/rooms/${args.propertySlug}` : "/",
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });
  });
}

it("records unknown questions and returns the safe fallback from chatAi.respond", async () => {
  vi.stubEnv("ADMIN_EMAILS", adminEmail);
  try {
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const sessionId = await createWebSession(t);

    const result = await t.action(api.chatAi.respond, {
      sessionId,
      userMessage: "Can I bring two cats?",
    });
    const unknownRows = await admin
      .query(api.chatKnowledge.adminListUnknownQuestions, {
        status: "new",
        paginationOpts: { numItems: 50, cursor: null },
      })
      .then((result) => result.page);

    expect(result).toMatchObject({
      model: "unknown_fallback",
      response:
        "I'm not fully sure about that yet. I'll ask the team and get back to you shortly.",
    });
    expect(unknownRows).toHaveLength(1);
    expect(unknownRows[0]).toMatchObject({
      userQuestion: "Can I bring two cats?",
      status: "new",
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
