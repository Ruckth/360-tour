// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { inboxBackfillPatch } from "./lib/inboxBackfill";
const modules = import.meta.glob("./**/*.ts");

describe("conservative inbox lifecycle backfill", () => {
  it.each([
    "I will check availability and get back to you.",
    "เดี๋ยวตรวจสอบให้แล้วแจ้งกลับนะคะ",
    "Yes, Wi-Fi is included.",
  ])(
    "keeps an unclassified legacy AI answer visible for review: %s",
    async (content) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const id = await ctx.db.insert("chatSessions", {
          channel: "web",
          createdAt: 1,
        });
        await ctx.db.insert("chatMessages", {
          sessionId: id,
          role: "user",
          content: "Help please",
          timestamp: 1,
        });
        await ctx.db.insert("chatMessages", {
          sessionId: id,
          role: "assistant",
          content,
          timestamp: 2,
        });
        const session = (await ctx.db.get(id))!;
        expect(await inboxBackfillPatch(ctx, session)).toMatchObject({
          inboxState: "needs_staff",
          inboxReason: "review_required",
        });
      });
    },
  );
  it("preserves an existing manual completion and skips already migrated sessions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("chatSessions", {
        channel: "web",
        adminStatus: "resolved",
        createdAt: 1,
      });
      await ctx.db.insert("chatMessages", {
        sessionId: id,
        role: "user",
        content: "Thank you",
        timestamp: 1,
      });
      const session = (await ctx.db.get(id))!;
      const patch = await inboxBackfillPatch(ctx, session);
      expect(patch).toMatchObject({
        inboxState: "done",
        resolutionSource: "manual",
      });
      await ctx.db.patch(id, patch!);
      expect(await inboxBackfillPatch(ctx, (await ctx.db.get(id))!)).toBeNull();
    });
  });
});
