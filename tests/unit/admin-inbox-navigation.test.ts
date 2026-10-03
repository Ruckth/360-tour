// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { AdminSession } from "@/components/admin/admin-chat-types";

type DetailProps = {
  selectedSession: AdminSession | null;
  actions: ReactNode;
  compact?: boolean;
  replyDraft: string;
  onReplyDraftChange: (value: string) => void;
  onSendReply: () => Promise<void>;
  replyPending: boolean;
  replyStatus: string | null;
};

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams("view=all&session=session-a"),
  replace: vi.fn(),
  mutation: vi.fn(),
  page: [] as unknown[],
  listResult: {} as unknown,
  listArgs: [] as Array<Record<string, unknown>>,
  detail: null as unknown,
  desktop: true,
  detailProps: [] as DetailProps[],
  // Stable like Convex: an unchanged subscription returns the same object between renders.
  transcript: { results: [], status: "Exhausted", loadMore: () => {} },
  empty: [] as unknown[],
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
    if (name === "adminChat:listSessions") {
      mocks.listArgs.push(args as Record<string, unknown>);
      return mocks.listResult;
    }
    if (name === "adminChat:getSessionDetail") return mocks.detail;
    return mocks.empty;
  },
  usePaginatedQuery: () => mocks.transcript,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({
  useConfirm: () => async () => true,
}));
vi.mock("@/components/admin/BusinessFactFormDialog", () => ({
  BusinessFactFormDialog: () => null,
}));
vi.mock("@/components/admin/AdminSessionDetail", () => ({
  chronologicalTranscriptMessages: (messages: unknown[]) => messages,
  AdminSessionDetail: (props: DetailProps) => {
    mocks.detailProps.push(props);
    return createElement(
      "div",
      { "data-selected": props.selectedSession?._id ?? "none", "data-compact": String(Boolean(props.compact)) },
      props.actions,
      createElement(
        "button",
        { type: "button", disabled: props.replyPending, onClick: () => void props.onSendReply() },
        "Send",
      ),
    );
  },
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
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function latestDetail() {
  return mocks.detailProps.at(-1)!;
}
function buttonByText(label: string) {
  return [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label)!;
}
function replyResponse(channel = "web") {
  return { ok: true, json: async () => ({ channel }) } as Response;
}
function sentSessionId(call: unknown[]) {
  return (JSON.parse((call[1] as RequestInit).body as string) as { sessionId: string }).sessionId;
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
  mocks.detailProps = [];
  mocks.listArgs = [];
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
  it("keeps a newly requested queue when search debounce fires before the URL commits", async () => {
    vi.useFakeTimers();
    try {
      mocks.search = new URLSearchParams("session=session-a");
      await render();
      const input = document.querySelector<HTMLInputElement>("#admin-chat-search")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "villa");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click("Done");
      // replace has been requested, but useSearchParams still has the original Waiting URL.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const destination = new URL(mocks.replace.mock.calls.at(-1)![0], "https://example.test");
      expect(destination.searchParams.get("state")).toBe("done");
      expect(destination.searchParams.get("view")).toBe("all");
      expect(destination.searchParams.get("q")).toBe("villa");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restore cleared filters while their URL update is pending", async () => {
    vi.useFakeTimers();
    try {
      mocks.search = new URLSearchParams("view=all&q=villa&channel=line&from=2026-10-01T00:00");
      mocks.page = [];
      mocks.detail = null;
      await render();
      await click("Clear search and filters");
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const destination = new URL(mocks.replace.mock.calls.at(-1)![0], "https://example.test");
      for (const key of ["q", "channel", "from", "to"]) expect(destination.searchParams.has(key)).toBe(false);
      expect(destination.searchParams.get("view")).toBe("all");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    "keeps a replying Waiting transcript visible until Open commits (desktop: %s)",
    async (desktop) => {
      mocks.desktop = desktop;
      mocks.search = new URLSearchParams("view=needs_reply&session=session-a");
      const pending = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => pending.promise),
      );
      await render();
      await act(async () => {
        latestDetail().onReplyDraftChange("Thanks for waiting.");
      });
      let sending!: Promise<void>;
      await act(async () => {
        sending = latestDetail().onSendReply();
      });
      // Convex updates arrive before the HTTP response: the guest no longer needs a reply.
      mocks.page = [];
      mocks.detail = { session: { ...session("session-a"), needsReply: false }, replyWindow: { applies: false } };
      await render();
      expect(document.querySelector('[data-selected="session-a"]')).not.toBeNull();
      await act(async () => {
        pending.resolve(replyResponse());
        await sending;
      });
      expect(latestDetail().replyPending).toBe(false);
      expect(document.querySelector('[data-selected="session-a"]')).not.toBeNull();
      const destination = mocks.replace.mock.calls.at(-1)![0] as string;
      expect(destination).toContain("view=all");
      mocks.search = new URLSearchParams(destination.split("?")[1]);
      await render();
      expect(document.querySelector('[data-selected="session-a"]')).not.toBeNull();
      // Re-visiting Waiting later must not inherit the completed operation's exemption.
      mocks.search = new URLSearchParams("view=needs_reply&session=session-a");
      await render();
      expect(document.querySelector('[data-selected="session-a"]')).toBeNull();
    },
  );

  it.each(["done", "resolved", "archived"])("uses all activity for old %s URLs without view", async (state) => {
    mocks.search = new URLSearchParams(`state=${state}&session=session-a`);
    const selectedStatus = state === "archived" ? "archived" : "resolved";
    mocks.page = [{ ...session("session-a", selectedStatus), needsReply: false }];
    mocks.detail = { session: mocks.page[0], replyWindow: { applies: false } };
    await render();
    expect(mocks.listArgs.at(-1)).toMatchObject({ status: "all", adminStatus: state });
    expect(document.querySelector('[data-selected="session-a"]')).not.toBeNull();
  });

  it("keeps Waiting after the initially selected guest becomes answered", async () => {
    mocks.search = new URLSearchParams("session=session-a");
    await render();
    mocks.replace.mockClear();
    mocks.page = [session("session-b")];
    mocks.detail = { session: { ...session("session-a"), needsReply: false }, replyWindow: { applies: false } };
    await render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(document.querySelector('[data-selected="session-a"]')).toBeNull();
  });

  it("does not treat a later in-app Waiting selection as an incoming deep link", async () => {
    mocks.search = new URLSearchParams("");
    mocks.page = [];
    mocks.detail = null;
    await render();
    mocks.search = new URLSearchParams("session=session-a");
    mocks.page = [session("session-a"), session("session-b")];
    mocks.detail = { session: session("session-a"), replyWindow: { applies: false } };
    await render();
    mocks.replace.mockClear();
    mocks.page = [session("session-b")];
    mocks.detail = { session: { ...session("session-a"), needsReply: false }, replyWindow: { applies: false } };
    await render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(document.querySelector('[data-selected="session-a"]')).toBeNull();
  });

  it.each(["session-b", "session-c"])("resolves %s to its adjacent conversation", async (id) => {
    mocks.search = new URLSearchParams(`view=all&session=${id}`);
    mocks.page = [session("session-a"), session("session-b"), session("session-c")];
    mocks.detail = { session: session(id), replyWindow: { applies: false } };
    await render();
    await click("Resolve");
    expect(mocks.replace.mock.calls.at(-1)?.[0]).toContain(
      id === "session-b" ? "session=session-c" : "session=session-b",
    );
  });

  it("queries only the debounced search", async () => {
    vi.useFakeTimers();
    try {
      await render();
      const input = document.querySelector<HTMLInputElement>("#admin-chat-search")!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const value of ["a", "ab", "abc"]) {
        await act(async () => {
          setValue.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      expect(mocks.listArgs.every((args) => args.searchQuery === undefined)).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(299);
      });
      expect(mocks.replace).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(mocks.replace).toHaveBeenCalledTimes(1);
      const destination = mocks.replace.mock.calls[0][0] as string;
      expect(destination).toContain("q=abc");
      mocks.search = new URLSearchParams(destination.split("?")[1]);
      mocks.page = [];
      mocks.detail = null;
      await render();
      expect(mocks.listArgs.at(-1)).toMatchObject({ searchQuery: "abc" });
    } finally {
      vi.useRealTimers();
    }
  });

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

describe("inbox replies", () => {
  async function type(value: string) {
    await act(async () => {
      latestDetail().onReplyDraftChange(value);
    });
  }

  it("keeps each conversation's reply independent and lets only the current one navigate", async () => {
    const replies = [deferred<Response>(), deferred<Response>()];
    const fetchMock = vi.fn().mockReturnValueOnce(replies[0].promise).mockReturnValueOnce(replies[1].promise);
    vi.stubGlobal("fetch", fetchMock);
    mocks.search = new URLSearchParams("view=needs_reply&session=session-a");
    await render();
    await type("Hello A");
    await click("Send");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(buttonByText("Send").disabled).toBe(true);

    // Staff move on to B while A is still sending.
    mocks.search = new URLSearchParams("view=needs_reply&session=session-b");
    await render();
    expect(latestDetail().selectedSession?._id).toBe("session-b");
    expect(latestDetail().replyDraft).toBe("");
    expect(buttonByText("Send").disabled).toBe(false);
    await type("Hello B");
    await click("Send");
    expect(fetchMock.mock.calls.map(sentSessionId)).toEqual(["session-a", "session-b"]);

    // A finishing must neither navigate away from B nor end B's pending state.
    mocks.replace.mockClear();
    await act(async () => {
      replies[0].resolve(replyResponse());
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(buttonByText("Send").disabled).toBe(true);

    await act(async () => {
      replies[1].resolve(replyResponse("line"));
    });
    expect(buttonByText("Send").disabled).toBe(false);
    expect(latestDetail().replyStatus).toBe("Reply accepted by LINE. Delivery is not confirmed.");
    // B replied from Waiting, so it stays visible in Open.
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace.mock.calls[0][0]).toBe("/admin/chats?view=all&session=session-b");

    // A kept its own result.
    mocks.search = new URLSearchParams("view=needs_reply&session=session-a");
    await render();
    expect(latestDetail().replyStatus).toBe("Reply sent");
    expect(latestDetail().replyDraft).toBe("");
  });

  it("sends a double-submitted reply once", async () => {
    const reply = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(reply.promise);
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await type("Hello");
    // Both clicks land before React re-renders the disabled button.
    await act(async () => {
      buttonByText("Send").click();
      buttonByText("Send").click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      reply.resolve(replyResponse());
    });
  });
});

describe("inbox detail panes", () => {
  it.each([true, false])("mounts exactly one conversation detail (desktop: %s)", async (desktop) => {
    mocks.desktop = desktop;
    await render();
    const details = document.querySelectorAll("[data-selected]");
    expect(details).toHaveLength(1);
    expect(details[0].getAttribute("data-selected")).toBe("session-a");
    expect(details[0].getAttribute("data-compact")).toBe(String(!desktop));
  });
});

describe("settling guest messages", () => {
  function waitingSession(id: string) {
    return {
      ...session(id),
      latestMessage: {
        _id: `${id}-message` as never,
        role: "user" as const,
        content: `Question from ${id}`,
        timestamp: 1,
      },
    };
  }
  function settleButtons() {
    return [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="Mark the message from"]')];
  }

  it("keeps a second settle pending when the first finishes", async () => {
    const settles = [deferred(), deferred()];
    mocks.mutation.mockReturnValueOnce(settles[0].promise).mockReturnValueOnce(settles[1].promise);
    mocks.page = [waitingSession("session-a"), waitingSession("session-b")];
    await render();
    await act(async () => {
      settleButtons()[0].click();
    });
    await act(async () => {
      settleButtons()[1].click();
    });
    expect(settleButtons().map((button) => button.disabled)).toEqual([true, true]);

    await act(async () => {
      settles[0].resolve();
    });
    expect(settleButtons().map((button) => button.disabled)).toEqual([false, true]);

    await act(async () => {
      settles[1].resolve();
    });
    expect(settleButtons().map((button) => button.disabled)).toEqual([false, false]);
  });

  it("ignores e for a message that is already being settled", async () => {
    const settle = deferred();
    mocks.mutation.mockReturnValueOnce(settle.promise);
    mocks.search = new URLSearchParams("view=needs_reply&session=session-a");
    mocks.page = [waitingSession("session-a"), waitingSession("session-b")];
    await render();
    await act(async () => {
      settleButtons()[0].click();
    });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    mocks.replace.mockClear();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    // Neither a second settle nor the move to the next chat.
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => {
      settle.resolve();
    });
  });
});
