// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const SECRET = "trusted-secret";
afterEach(() => vi.unstubAllEnvs());

const channels = [
  { channel: "line", table: "lineWebhookEvents", sender: { lineUserId: "U-secret-test" } },
  { channel: "facebook", table: "facebookWebhookEvents", sender: { facebookUserId: "fb-secret-test" } },
  { channel: "instagram", table: "instagramWebhookEvents", sender: { instagramUserId: "ig-secret-test" } },
  { channel: "whatsapp", table: "whatsappWebhookEvents", sender: { whatsappUserId: "66911111111" } },
] as const;

const misconfigurations = [
  { name: "unset", configured: undefined, provided: "anything" },
  { name: "empty", configured: "", provided: "" },
  { name: "incorrect", configured: SECRET, provided: "forged" },
] as const;

describe("channel server secret", () => {
  it.each(channels)("$channel rejects every protected mutation without writing rows", async ({ channel, table, sender }) => {
    vi.stubEnv("CONVEX_SERVER_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const mutations = api[channel];
    const seed = await t.mutation(mutations.claimEvent, {
      serverSecret: SECRET, eventKey: "seed", eventType: "message", ...sender,
    } as never) as unknown as { eventId: never; sessionId: never };
    const snapshot = () => t.run(async (ctx) => ({
      events: await ctx.db.query(table).collect(),
      sessions: await ctx.db.query("chatSessions").collect(),
      messages: await ctx.db.query("chatMessages").collect(),
    }));
    const before = await snapshot();

    for (const { configured, provided } of misconfigurations) {
      vi.stubEnv("CONVEX_SERVER_SECRET", configured);
      const ids = { serverSecret: provided, eventId: seed.eventId };
      const calls = [
        () => t.mutation(mutations.claimEvent, { serverSecret: provided, eventKey: "forged", eventType: "message", ...sender } as never),
        () => t.mutation(mutations.recordInboundEvent, { ...ids, sessionId: seed.sessionId, userContent: "forged" } as never),
        () => t.mutation(mutations.completeEvent, { ...ids, sessionId: seed.sessionId, assistantContent: "forged", replyMode: "exact" } as never),
        () => t.mutation(mutations.markEventIgnored, { ...ids, reason: "forged" } as never),
        () => t.mutation(mutations.markEventFailed, { ...ids, error: "forged" } as never),
      ];
      for (const call of calls) await expect(call()).rejects.toThrow(/server secret|CONVEX_SERVER_SECRET/i);
    }

    expect(await snapshot()).toEqual(before);
    vi.stubEnv("CONVEX_SERVER_SECRET", SECRET);
    const accepted = await t.mutation(mutations.claimEvent, {
      serverSecret: SECRET, eventKey: "trusted", eventType: "message", ...sender,
    } as never) as { duplicate: boolean };
    expect(accepted.duplicate).toBe(false);
  });
});
