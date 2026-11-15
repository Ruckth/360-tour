// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createHarness } from "../../convex/testing/harness";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { storeGuestToken } from "@/components/chat/session/credentials";
import { useChatSuggestions } from "@/components/chat/session/useChatSuggestions";

const transport = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => transport }));
vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate };
});
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});
function Harness({ sessionId }: { sessionId: Id<"conversations"> }) {
  const { suggestions, visibleSuggestions } = useChatSuggestions(sessionId, undefined, null);
  return createElement("div", { "data-candidates": suggestions.length },
    visibleSuggestions.map((suggestion) => createElement("button", { key: suggestion.id }, suggestion.id)));
}
it("records all six initial chips from twelve candidates in valid five-chip batches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const t = createHarness(convexTest);
  const credentials = await t.mutation(api.messaging.chat.createSession, { channel: "web" });
  storeGuestToken(credentials.sessionId, credentials.guestToken);
  transport.query.mockImplementation((ref, args) => t.query(ref, args));
  transport.mutation.mockImplementation((ref, args) => t.mutation(ref, args));
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root!.render(createElement(Harness, { sessionId: credentials.sessionId })));
  await act(async () => {
    await vi.waitFor(async () => {
      const rows = await t.run((ctx) => ctx.db.query("chatStaticSuggestionInteractions").collect());
      expect(rows).toHaveLength(6);
    });
  });
  expect(node.firstElementChild?.getAttribute("data-candidates")).toBe("12");
  expect(node.querySelectorAll("button")).toHaveLength(6);
  const tracked = await t.run((ctx) => ctx.db.query("chatStaticSuggestionInteractions").collect());
  expect(tracked).toHaveLength(6);
  expect(tracked.every((row) => row.shownAt !== undefined)).toBe(true);
  expect(new Set(tracked.map((row) => row.suggestionKey)).size).toBe(6);
  expect(transport.mutation.mock.calls.map(([, args]) => args.suggestions.length)).toEqual([5, 1]);
  for (const [, args] of transport.query.mock.calls) {
    expect(args.candidateSuggestionIds.length).toBeLessThanOrEqual(5);
    expect(args.limit).toBeLessThanOrEqual(5);
    expect(args.guestToken).toBe(credentials.guestToken);
  }
});
