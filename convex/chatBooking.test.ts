// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

function isoInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const checkIn = isoInDays(30);
const checkOut = isoInDays(33);

async function setup(channel: "whatsapp" | "line" | "facebook" | "web" = "whatsapp") {
  const t = convexTest(schema, modules);
  const { propertyId, sessionId } = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert("properties", {
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
      amenities: ["Private Pool"],
      tourRoomIds: [],
      directDiscountPercent: 15,
      status: "active",
    });
    const sessionId = await ctx.db.insert("chatSessions", {
      channel,
      visitorId: `${channel}:guest`,
      ...(channel === "whatsapp" ? { visitorPhone: "66956823432", visitorName: "Rugby" } : {}),
      createdAt: Date.now(),
    });
    return { propertyId, sessionId };
  });
  return { t, propertyId, sessionId };
}

const stay = { propertySlug: "pool-villa", checkIn, checkOut, guests: 2, guestName: "Rugby" };

async function listBookings(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query("bookings").collect());
}

describe("AI chat booking", () => {
  it("rejects confirm_booking without a prepared quote", async () => {
    const { t, sessionId } = await setup();
    await expect(
      t.mutation(internal.bookings.confirmChatBooking, { sessionId }),
    ).rejects.toThrow("No prepared booking");
    expect(await listBookings(t)).toHaveLength(0);
  });

  it("rejects a stale quote", async () => {
    const { t, sessionId } = await setup();
    await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
    await t.run(async (ctx) => {
      const session = await ctx.db.get(sessionId);
      await ctx.db.patch(sessionId, {
        pendingBookingQuote: { ...session!.pendingBookingQuote!, createdAt: Date.now() - 16 * 60_000 },
      });
    });

    await expect(
      t.mutation(internal.bookings.confirmChatBooking, { sessionId }),
    ).rejects.toThrow("expired");
    expect(await listBookings(t)).toHaveLength(0);
  });

  it("rejects dates that are already taken", async () => {
    const { t, sessionId, propertyId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("bookings", {
        propertyId,
        guestName: "Someone",
        guestPhone: "+66000000000",
        checkIn: isoInDays(31),
        checkOut: isoInDays(35),
        guests: 2,
        nights: 4,
        subtotal: 40000,
        discountAmount: 0,
        total: 40000,
        currency: "THB",
        paymentStatus: "paid",
        status: "confirmed",
        createdAt: Date.now(),
      });
    });

    await expect(
      t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay }),
    ).rejects.toThrow("no longer available");
  });

  it("confirms once even if the guest says yes twice", async () => {
    const { t, sessionId } = await setup();
    await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });

    const first = await t.mutation(internal.bookings.confirmChatBooking, { sessionId });
    const second = await t.mutation(internal.bookings.confirmChatBooking, { sessionId });

    expect(second.bookingId).toBe(first.bookingId);
    expect(second.alreadyConfirmed).toBe(true);
    const bookings = await listBookings(t);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      source: "whatsapp",
      chatSessionId: sessionId,
      status: "pending",
      total: 25500,
      confirmationCode: first.confirmationCode,
    });
  });

  it("takes the WhatsApp phone from the session, not from model arguments", async () => {
    const { t, sessionId } = await setup("whatsapp");
    const summary = await t.mutation(internal.bookings.prepareChatBooking, {
      sessionId,
      ...stay,
      guestPhone: "+1 555 000 0000",
    });
    await t.mutation(internal.bookings.confirmChatBooking, { sessionId });

    expect(summary.guestPhone).toBe("66956823432");
    expect((await listBookings(t))[0].guestPhone).toBe("66956823432");
  });

  it("requires a phone number on channels without a verified one", async () => {
    const { t, sessionId } = await setup("facebook");
    await expect(
      t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay }),
    ).rejects.toThrow("phone number");

    const summary = await t.mutation(internal.bookings.prepareChatBooking, {
      sessionId,
      ...stay,
      guestPhone: "0812345678",
    });
    expect(summary.guestPhone).toBe("0812345678");
  });
});

type ToolCallSpec = { name: string; args?: Record<string, unknown> };

function aiResponse(content: string | null, toolCalls: ToolCallSpec[] = []) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
            ...(toolCalls.length
              ? {
                  tool_calls: toolCalls.map((call, index) => ({
                    id: `call-${call.name}-${index}`,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
                  })),
                }
              : {}),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function runWithAi(
  responses: Response[],
  fn: (toolResults: string[]) => Promise<void>,
) {
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
  const toolResults: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content: string }>;
      };
      const last = body.messages[body.messages.length - 1];
      if (last?.role === "tool") toolResults.push(last.content);
      return responses.shift() ?? aiResponse("done");
    }),
  );
  try {
    await fn(toolResults);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}

describe("AI chat booking through generateReply", () => {
  it("won't confirm in the same turn as prepare, then books after the guest says yes", async () => {
    const { t, sessionId } = await setup("line");
    const reply = (userMessage: string) =>
      t.action(api.chatAi.generateReply, {
        sessionId: sessionId as Id<"chatSessions">,
        userMessage,
        channel: "line",
        siteUrl: "https://tour.example.com",
        bookingFlow: true,
      });

    await runWithAi(
      [
        aiResponse(null, [
          { name: "prepare_booking", args: { ...stay, guestPhone: "0812345678" } },
          { name: "confirm_booking" },
        ]),
        aiResponse("Pool Villa, 3 nights, ฿25,500. Reply yes to confirm."),
      ],
      async (toolResults) => {
        await reply(`Book pool villa ${checkIn} to ${checkOut} for 2, Rugby 0812345678`);
        expect(toolResults.join("\n")).toContain("Ask the guest to confirm the summary first");
      },
    );
    expect(await listBookings(t)).toHaveLength(0);
    expect(await t.query(api.bookings.isChatBookingFlowActive, { sessionId })).toBe(true);

    await runWithAi(
      [aiResponse(null, [{ name: "confirm_booking" }]), aiResponse("Booked!")],
      async (toolResults) => {
        const result = await reply("yes");
        expect(result.response).toBe("Booked!");
        expect(toolResults[0]).toContain("https://tour.example.com/booking/pay?bookingId=");
      },
    );
    const bookings = await listBookings(t);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ source: "line", guestPhone: "0812345678" });
  });

  it("does not offer booking tools in web chat", async () => {
    const { t, sessionId } = await setup("web");
    await runWithAi(
      [aiResponse(null, [{ name: "prepare_booking", args: { ...stay, guestPhone: "0812345678" } }])],
      async (toolResults) => {
        await t.action(api.chatAi.generateReply, { sessionId, userMessage: "book it", channel: "web" });
        expect(toolResults[0]).toContain("Unknown function: prepare_booking");
      },
    );
    expect(await listBookings(t)).toHaveLength(0);
  });
});
