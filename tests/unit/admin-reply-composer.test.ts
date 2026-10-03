// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { useAdminReplyComposer, type AdminReplyComposer } from "@/components/admin/useAdminReplyComposer";

const auth = vi.hoisted(() => ({ token: "test-token" as string | null }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: async () => auth.token }),
}));

const A = "session-a" as Id<"chatSessions">;
const B = "session-b" as Id<"chatSessions">;
let root: Root;
let composer: AdminReplyComposer;

function Harness({ sessionId }: { sessionId: Id<"chatSessions"> | null }) {
  const current = useAdminReplyComposer(sessionId);
  useEffect(() => {
    composer = current;
  });
  return null;
}
async function render(sessionId: Id<"chatSessions"> | null) {
  await act(async () => {
    root.render(createElement(Harness, { sessionId }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function response(ok: boolean, body: { channel?: string; error?: string }) {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.token = "test-token";
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

describe("useAdminReplyComposer", () => {
  it("posts the trimmed draft with the Clerk token and reports channel feedback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(true, { channel: "whatsapp" }));
    vi.stubGlobal("fetch", fetchMock);
    const onSent = vi.fn();
    await render(A);
    await act(async () => composer.setDraft("  Hello  "));
    await act(async () => composer.send(onSent));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/chat/reply");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    expect(JSON.parse(init.body as string)).toMatchObject({ sessionId: A, content: "Hello" });
    expect(composer).toMatchObject({
      draft: "",
      pending: false,
      error: null,
      status: "Reply accepted by WhatsApp. Delivery is not confirmed.",
    });
    expect(onSent).toHaveBeenCalledWith(A);
  });

  it("keeps the draft and skips the completion callback when sending fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(false, { error: "Reply window closed" })));
    const onSent = vi.fn();
    await render(A);
    await act(async () => composer.setDraft("Hello"));
    await act(async () => composer.send(onSent));
    expect(composer).toMatchObject({ draft: "Hello", pending: false, error: "Reply window closed", status: null });
    expect(onSent).not.toHaveBeenCalled();

    // A retry clears the old error while it is in flight.
    const retry = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(retry.promise));
    let sending!: Promise<void>;
    await act(async () => {
      sending = composer.send();
    });
    expect(composer).toMatchObject({ pending: true, error: null });
    await act(async () => {
      retry.resolve(response(true, { channel: "web" }));
      await sending;
    });
    expect(composer).toMatchObject({ draft: "", status: "Reply sent" });
  });

  it("reports an expired sign-in without calling the reply endpoint", async () => {
    auth.token = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(A);
    await act(async () => composer.setDraft("Hello"));
    await act(async () => composer.send());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(composer).toMatchObject({ draft: "Hello", error: "Admin sign-in has expired. Sign in again." });
  });

  it("keeps a draft edited while the reply was in flight", async () => {
    const reply = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(reply.promise));
    await render(A);
    await act(async () => composer.setDraft("First"));
    let sending!: Promise<void>;
    await act(async () => {
      sending = composer.send();
    });
    await act(async () => composer.setDraft("Follow-up"));
    await act(async () => {
      reply.resolve(response(true, { channel: "web" }));
      await sending;
    });
    expect(composer).toMatchObject({ draft: "Follow-up", status: "Reply sent", pending: false });
  });

  it("sends once when the same session submits twice before React commits", async () => {
    const reply = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(reply.promise);
    vi.stubGlobal("fetch", fetchMock);
    await render(A);
    await act(async () => composer.setDraft("Hello"));
    const { send } = composer;
    let sends!: Promise<unknown>;
    await act(async () => {
      sends = Promise.all([send(), send()]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      reply.resolve(response(true, { channel: "web" }));
      await sends;
    });
  });

  it("lets different sessions send independently", async () => {
    const replies = { [A]: deferred<Response>(), [B]: deferred<Response>() };
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const { sessionId } = JSON.parse(init.body as string) as { sessionId: typeof A };
      return replies[sessionId].promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSent = vi.fn();
    await render(A);
    await act(async () => composer.setDraft("Hello A"));
    let sendingA!: Promise<void>;
    await act(async () => {
      sendingA = composer.send(onSent);
    });

    await render(B);
    expect(composer).toMatchObject({ draft: "", pending: false });
    await act(async () => composer.setDraft("Hello B"));
    let sendingB!: Promise<void>;
    await act(async () => {
      sendingB = composer.send(onSent);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      replies[B].resolve(response(true, { channel: "line" }));
      await sendingB;
    });
    expect(composer).toMatchObject({ pending: false, status: "Reply accepted by LINE. Delivery is not confirmed." });

    await render(A);
    expect(composer).toMatchObject({ pending: true, draft: "Hello A" });
    await act(async () => {
      replies[A].resolve(response(true, { channel: "web" }));
      await sendingA;
    });
    expect(composer).toMatchObject({ pending: false, draft: "", status: "Reply sent" });
    expect(onSent.mock.calls).toEqual([[B], [A]]);
  });

  it("does nothing without a selected session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(null);
    await act(async () => composer.setDraft("Hello"));
    await act(async () => composer.send());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(composer).toMatchObject({ draft: "", pending: false, error: null, status: null });
  });
});
