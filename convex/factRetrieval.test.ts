// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({
    email: "admin@example.com",
    tokenIdentifier: "admin",
  });
  const property = (slug: string) =>
    t.run((ctx) =>
      ctx.db.insert("properties", {
        slug,
        name: slug,
        tagline: "",
        description: "",
        pricePerNight: 1000,
        currency: "THB",
        maxGuests: 4,
        bedrooms: 2,
        bathrooms: 1,
        area: 60,
        images: [],
        amenities: ["WiFi"],
        tourRoomIds: [],
        directDiscountPercent: 10,
        status: "active",
      }),
    );
  const pool = await property("pool-villa");
  const garden = await property("garden-villa");
  const sessionId = await t.mutation(api.chat.createSession, {
    channel: "web",
    propertySlug: "pool-villa",
  });
  const fact = (
    body: string,
    overrides: Partial<
      Parameters<typeof admin.mutation<typeof api.businessFacts.adminSave>>[1]
    > = {},
  ) =>
    admin.mutation(api.businessFacts.adminSave, {
      title: "Breakfast",
      body,
      searchText: "breakfast included meal morning",
      source: "Owner-confirmed policy",
      status: "approved",
      ...overrides,
    });
  return { t, admin, pool, garden, sessionId, fact };
}

describe("business fact evidence", () => {
  it("disables retrieval without reviving old context when the cohort is zero", async () => {
    const { t, sessionId, fact } = await setup();
    await fact("Included.");
    vi.stubEnv("AI_FACT_RETRIEVAL_PERCENT", "0");
    expect(
      await t.query(internal.businessFacts.search, {
        sessionId,
        query: "breakfast",
      }),
    ).toEqual({ facts: [], noMatch: true });
    expect(
      await t.query(internal.chatKnowledge.getApprovedContext, { sessionId }),
    ).toEqual([]);
  });
  it("requires an administrator and a source, and prevents lost edits", async () => {
    const { t, admin, fact } = await setup();
    const input = {
      title: "Breakfast",
      body: "Included.",
      searchText: "breakfast",
      source: "Owner",
      status: "approved" as const,
    };
    await expect(
      t.mutation(api.businessFacts.adminSave, input),
    ).rejects.toThrow("Not authenticated");
    await expect(
      admin.mutation(api.businessFacts.adminSave, { ...input, source: "" }),
    ).rejects.toThrow("Source");
    const id = await fact("Included.");
    await admin.mutation(api.businessFacts.adminSave, {
      ...input,
      factId: id,
      expectedRevision: 1,
    });
    await expect(
      admin.mutation(api.businessFacts.adminSave, {
        ...input,
        factId: id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow("changed");
  });
  it("retrieves scoped evidence ahead of global and excludes other properties and unpublished facts", async () => {
    const { t, pool, garden, sessionId, fact } = await setup();
    await fact("Global breakfast.");
    await fact("Pool breakfast.", { propertyId: pool });
    await fact("Garden breakfast.", { propertyId: garden });
    await fact("Draft breakfast.", { status: "draft" });
    await fact("Archived breakfast.", { status: "archived" });
    const result = await t.query(internal.businessFacts.search, {
      sessionId,
      query: "breakfast",
    });
    expect(result.facts.map((f) => f.body)).toEqual(["Pool breakfast."]);
    expect(result.facts[0]).toMatchObject({
      propertySlug: "pool-villa",
      revision: 1,
      source: "Owner-confirmed policy",
    });
    const named = await t.query(internal.businessFacts.search, {
      sessionId,
      query: "breakfast",
      propertySlug: "garden-villa",
    });
    expect(named.facts.map((f) => f.body)).toEqual(["Garden breakfast."]);
  });
  it("finds older relevant scoped facts despite many unrelated property facts", async () => {
    const { t, pool, garden, sessionId, fact } = await setup();
    const wanted = await fact("Pool breakfast.", { propertyId: pool });
    await t.run(async (ctx) => {
      for (let i = 0; i < 130; i++)
        await ctx.db.insert("businessFacts", {
          title: `Breakfast ${i}`,
          body: "Unrelated villa.",
          searchText: "breakfast",
          source: "Owner",
          propertyId: garden,
          status: "approved",
          revision: 1,
          createdAt: i,
          updatedAt: i,
          createdByAdminEmail: "admin@example.com",
          updatedByAdminEmail: "admin@example.com",
        });
    });
    expect(
      (
        await t.query(internal.businessFacts.search, {
          sessionId,
          query: "breakfast",
        })
      ).facts.map((f) => f.factId),
    ).toEqual([wanted]);
  });
  it("returns current revisions, rejects invalid scope/paused sessions, and bounds evidence", async () => {
    const { t, admin, pool, sessionId, fact } = await setup();
    const id = await fact("Old policy.");
    await admin.mutation(api.businessFacts.adminSave, {
      factId: id,
      expectedRevision: 1,
      title: "Breakfast",
      body: "New policy.",
      searchText: "breakfast",
      source: "Updated owner policy",
      status: "approved",
    });
    const result = await t.query(internal.businessFacts.search, {
      sessionId,
      query: "breakfast",
    });
    expect(result.facts[0]).toMatchObject({ body: "New policy.", revision: 2 });
    for (let i = 0; i < 9; i++)
      await fact("Long approved breakfast note. ".repeat(60), {
        title: `Breakfast ${i}`,
        propertyId: pool,
      });
    const bounded = await t.query(internal.businessFacts.search, {
      sessionId,
      query: "breakfast",
    });
    expect(bounded.facts.length).toBeLessThanOrEqual(6);
    expect(
      bounded.facts.reduce(
        (size, f) => size + f.body.length + f.title.length + f.source.length,
        0,
      ),
    ).toBeLessThanOrEqual(8000);
    await expect(
      t.query(internal.businessFacts.search, {
        sessionId,
        query: "breakfast",
        propertySlug: "unknown-villa",
      }),
    ).rejects.toThrow("Unknown active property");
    await t.run((ctx) => ctx.db.patch(sessionId, { aiPaused: true }));
    await expect(
      t.query(internal.businessFacts.search, { sessionId, query: "breakfast" }),
    ).rejects.toThrow("active AI session");
  });
  it.each([
    ["Is breakfast included?", "Breakfast is included."],
    ["อาหารเช้ารวมไหม", "รวมอาหารเช้าครับ"],
    ["조식이 포함되어 있나요?", "조식이 포함되어 있습니다."],
  ])(
    "fetches English search evidence before answering in the guest language: %s",
    async (message, expected) => {
      const { t, sessionId, fact } = await setup();
      await fact("Breakfast is included.");
      vi.stubEnv("AI_API_KEY", "test-key");
      vi.stubEnv("AI_API_BASE_URL", "https://ai.test/v1");
      const requests: Array<{
        messages: Array<{ role: string; content: string }>;
      }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          const request = JSON.parse(String(init?.body));
          requests.push(request);
          const tool = request.messages.find(
            (m: { role: string }) => m.role === "tool",
          );
          if (tool)
            expect(JSON.parse(tool.content).facts[0].body).toBe(
              "Breakfast is included.",
            );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: tool
                    ? { content: expected }
                    : {
                        content: null,
                        tool_calls: [
                          {
                            id: "fact-read",
                            type: "function",
                            function: {
                              name: "search_business_facts",
                              arguments: '{"query":"breakfast included"}',
                            },
                          },
                        ],
                      },
                },
              ],
            }),
          );
        }),
      );
      expect(
        (
          await t.action(api.chatAi.respond, {
            sessionId,
            userMessage: message,
          })
        ).response,
      ).toBe(expected);
      expect(requests).toHaveLength(2);
      const system = requests[0].messages[0].content;
      expect(system).not.toContain("OWNER-APPROVED KNOWLEDGE");
      expect(system).not.toContain("Candidate question-bank items");
      expect(system).toContain("Previous assistant replies");
    },
  );
  it("records missing context after an empty fact lookup without publishing model output", async () => {
    const { t, sessionId } = await setup();
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const messages = JSON.parse(String(init?.body)).messages;
        const tool = messages.find((m: { role: string }) => m.role === "tool");
        if (tool)
          expect(JSON.parse(tool.content)).toEqual({
            facts: [],
            noMatch: true,
          });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: tool
                  ? { content: "[[UNKNOWN]]" }
                  : {
                      content: null,
                      tool_calls: [
                        {
                          id: "read",
                          type: "function",
                          function: {
                            name: "search_business_facts",
                            arguments: '{"query":"airport pickup"}',
                          },
                        },
                      ],
                    },
              },
            ],
          }),
        );
      }),
    );
    const reply = await t.action(api.chatAi.respond, {
      sessionId,
      userMessage: "Is airport pickup included?",
    });
    expect(reply.model).toBe("unknown_fallback");
    expect(
      await t.run((ctx) => ctx.db.query("chatUnknownQuestions").take(10)),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("businessFacts").take(10)),
    ).toEqual([]);
  });
});

it("attributes a missing policy to the explicitly looked-up villa rather than the viewed page", async () => {
  const { t, sessionId, garden } = await setup();
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)).messages;
      const tool = messages.find((m: { role: string }) => m.role === "tool");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: tool
                ? { content: "[[UNKNOWN]]" }
                : {
                    content: null,
                    tool_calls: [
                      {
                        id: "read",
                        type: "function",
                        function: {
                          name: "search_business_facts",
                          arguments:
                            '{"query":"breakfast","propertySlug":"garden-villa"}',
                        },
                      },
                    ],
                  },
            },
          ],
        }),
      );
    }),
  );
  const result = await t.action(api.chatAi.respond, {
    sessionId,
    userMessage: "가든 빌라에 조식이 포함되나요?",
    locale: "ko",
  });
  expect(result.response).toContain("확인된 정보");
  expect(result.response).not.toContain("shortly");
  expect(
    (await t.run((ctx) => ctx.db.query("chatUnknownQuestions").take(10)))[0],
  ).toMatchObject({ propertyId: garden, propertySlug: "garden-villa" });
});

it("labels partial unsaved settings as demo defaults and respects localized policy menus", async () => {
  const { t, sessionId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("siteSettings", {
      key: "default",
      businessName: "Test resort",
      updatedAt: Date.now(),
      updatedByEmail: "admin@example.com",
    }),
  );
  const demo = await t.action(api.chatAi.respond, {
    sessionId,
    userMessage: "What is your cancellation policy?",
  });
  expect(demo.response).toContain("Demo default, not a host-confirmed policy");
  const check = await t.action(api.chatAi.respond, {
    sessionId,
    userMessage: "Check-in time?",
    locale: "ko",
  });
  expect(check.response).toContain("데모 기본값");
  expect(check.response).toContain("체크인");
  vi.stubEnv("AI_API_KEY", "test-key");
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const prompt = JSON.parse(String(init?.body)).messages[0].content;
    expect(prompt).toContain("cancellationPolicy");
    expect(prompt).toContain("guest locale th");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "นี่เป็นนโยบายค่าเริ่มต้นของเดโม กรุณายืนยันกับเจ้าของที่พัก",
            },
          },
        ],
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const translated = await t.action(api.chatAi.generateReply, {
    sessionId,
    userMessage: "What is the cancellation policy?",
    locale: "th",
  });
  expect(translated.response).toContain("ค่าเริ่มต้น");
  expect(fetchMock).toHaveBeenCalledOnce();
});
