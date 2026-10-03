import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/components/chat/chat-types";
import {
  clearKnownChatMessageCaches,
  getMessageCacheStorageKey,
  latestExchangeFromMessages,
  mergeAdminMessages,
  normalizeTranscriptMessages,
  readCachedChatMessages,
  withStaffReplyNotice,
  writeCachedChatMessages,
  MESSAGE_CACHE_VERSION,
} from "@/components/chat/session/message-cache";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

beforeEach(() => {
  const storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage } as unknown as Window);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("message cache restore", () => {
  it("round-trips a transcript through localStorage and restores it", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there" },
    ];
    writeCachedChatMessages("sess-1", messages, null);

    const restored = readCachedChatMessages("sess-1");
    expect(restored?.messages).toEqual(messages);
    expect(restored?.latestExchange).toEqual({
      userMessage: "Hi",
      assistantMessage: "Hello there",
    });
    expect(restored?.version).toBe(MESSAGE_CACHE_VERSION);
  });

  it("promotes the local cache to the session key on write", () => {
    writeCachedChatMessages(null, [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], null);
    expect(readCachedChatMessages(null)).not.toBeNull();

    writeCachedChatMessages("sess-2", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], null);
    expect(window.localStorage.getItem(getMessageCacheStorageKey(null))).toBeNull();
    expect(readCachedChatMessages("sess-2")).not.toBeNull();
  });

  it("rejects a cache written with a different version", () => {
    window.localStorage.setItem(
      getMessageCacheStorageKey("sess-3"),
      JSON.stringify({ version: 999, messages: [{ role: "user", content: "x" }] }),
    );
    expect(readCachedChatMessages("sess-3")).toBeNull();
  });

  it("clears both the session and local caches", () => {
    writeCachedChatMessages("sess-4", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], null);
    clearKnownChatMessageCaches("sess-4");
    expect(readCachedChatMessages("sess-4")).toBeNull();
  });
});

describe("transcript merge and dedupe", () => {
  it("appends admin messages once, keyed by server id", () => {
    const existing: ChatMessage[] = [{ role: "user", content: "Where is check-in?" }];
    const transcript = [
      { _id: "m1", source: "admin", content: "By the lobby" },
      { _id: "m1", source: "admin", content: "By the lobby" },
      { _id: "m2", source: "ai", content: "ignored, not admin" },
    ];
    const merged = mergeAdminMessages(existing, transcript);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual({ id: "m1", role: "assistant", content: "By the lobby" });
  });

  it("returns the same reference when nothing new arrives", () => {
    const existing: ChatMessage[] = [{ id: "m1", role: "assistant", content: "hi" }];
    const transcript = [{ _id: "m1", source: "admin", content: "hi" }];
    expect(mergeAdminMessages(existing, transcript)).toBe(existing);
  });

  it("flags the guest message with a staff reply notice", () => {
    const items: ChatMessage[] = [
      { role: "user", content: "Can someone help?" },
      { role: "assistant", content: "..." },
    ];
    const flagged = withStaffReplyNotice(items, "Can someone help?");
    expect(flagged[0].staffReplyNotice).toBe(true);
  });

  it("normalizes assistant transcript rows with action hints", () => {
    const rows = [
      { _id: "u1", role: "user" as const, content: "book please" },
      { _id: "a1", role: "assistant" as const, content: "pick a villa", action: "booking" as const },
    ];
    const normalized = normalizeTranscriptMessages(rows);
    expect(normalized[1]).toEqual({ role: "assistant", content: "pick a villa", action: "booking" });
  });

  it("finds the latest user/assistant exchange", () => {
    const items: ChatMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ];
    expect(latestExchangeFromMessages(items)).toEqual({ userMessage: "q2", assistantMessage: "a2" });
  });
});
