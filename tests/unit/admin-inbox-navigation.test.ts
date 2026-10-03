// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { AdminSession } from "@/components/admin/admin-chat-types";

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams("view=all&session=session-a"),
  replace: vi.fn(),
  mutation: vi.fn(),
  page: [] as unknown[],
  listResult: {} as unknown,
  detail: null as unknown,
  desktop: true,
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: async () => "test-token" }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.search,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(reference);
    if (name === "adminChat:listSessions") return mocks.listResult;
    if (name === "adminChat:getSessionDetail") return mocks.detail;
    return [];
  },
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({
  useConfirm: () => async () => true,
}));
vi.mock("@/components/admin/BusinessFactFormDialog", () => ({
  BusinessFactFormDialog: () => null,
}));
vi.mock("@/components/admin/AdminSessionDetail", () => ({
  chronologicalTranscriptMessages: (messages: unknown[]) => messages,
  AdminSessionDetail: ({ selectedSession, actions }: { selectedSession: AdminSession | null; actions: ReactNode }) =>
    createElement("div", { "data-selected": selectedSession?._id ?? "none" }, actions),
}));
import { ChatsView } from "@/components/admin/ChatsView";

let root: Root;
function session(id: string, status: AdminSession["adminStatus"] = "open"): AdminSession {
  return {
    _id: id as AdminSession["_id"],
    channel: "web",
    createdAt: 1,
    isActive: false,
    adminStatus: status,
    needsReply: true,
  };
}
async function render() {
  mocks.listResult = {
    sessions: mocks.page,
    isDone: true,
    continueCursor: null,
  };
  await act(async () => {
    root.render(createElement(ChatsView));
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: mocks.desktop,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mocks.search = new URLSearchParams("view=all&session=session-a");
  mocks.page = [session("session-a"), session("session-b")];
  mocks.detail = {
    session: session("session-a"),
    replyWindow: { applies: false },
  };
  mocks.desktop = true;
  vi.clearAllMocks();
  mocks.mutation.mockResolvedValue(undefined);
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("inbox navigation", () => {
  it("opens an explicitly selected Waiting conversation even when the current page has no matches", async () => {
    mocks.search = new URLSearchParams("session=session-a");
    mocks.page = [];
    await render();
    expect(document.querySelector('[data-selected="session-a"]')).not.toBeNull();
  });

  it.each(["open", "resolved", "archived"] as const)(
    "opens unqualified staff links for %s conversations",
    async (status) => {
      mocks.search = new URLSearchParams("session=session-a");
      mocks.page = [];
      mocks.detail = {
        session: { ...session("session-a", status), needsReply: false },
        replyWindow: { applies: false },
      };
      await render();
      expect(document.querySelector('[data-selected="session-a"]')).not.toBeNull();
      const destination = mocks.replace.mock.calls.at(-1)?.[0] as string;
      expect(destination).toContain("view=all");
      expect(destination).toContain("session=session-a");
      expect(destination.includes("state=done")).toBe(status !== "open");
    },
  );

  it("keeps an explicitly filtered Waiting view scoped to unanswered conversations", async () => {
    mocks.search = new URLSearchParams("view=needs_reply&session=session-a");
    mocks.page = [];
    mocks.detail = {
      session: { ...session("session-a"), needsReply: false },
      replyWindow: { applies: false },
    };
    await render();
    expect(document.querySelector('[data-selected="none"]')).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each(["selection", "queue"])("ignores late status navigation after a newer %s", async (navigation) => {
    const pending = deferred();
    mocks.mutation.mockReturnValueOnce(pending.promise);
    await render();
    await click("Resolve");
    mocks.search = new URLSearchParams(
      navigation === "selection" ? "view=all&session=session-b" : "view=all&state=done",
    );
    mocks.detail = {
      session: session("session-b"),
      replyWindow: { applies: false },
    };
    if (navigation === "queue") mocks.page = [];
    await render();
    mocks.replace.mockClear();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([true, false])("advances after archiving from Done (desktop: %s)", async (desktop) => {
    mocks.desktop = desktop;
    mocks.search = new URLSearchParams("view=all&state=done&session=session-a");
    mocks.page = [session("session-a", "resolved"), session("session-b", "resolved")];
    mocks.detail = {
      session: session("session-a", "resolved"),
      replyWindow: { applies: false },
    };
    await render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="More conversation actions"]')!.click();
    });
    await click("Archive conversation");
    const destination = mocks.replace.mock.calls.at(-1)?.[0] as string;
    expect(destination).toContain("state=done");
    expect(destination.includes("session=session-b")).toBe(desktop);
    expect(destination).not.toContain("session=session-a");
  });
});
