import { describe, expect, it } from "vitest";
import {
  DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT,
  isReusableChatMessageCount,
} from "convex/lib/chatReuse";

describe("isReusableChatMessageCount", () => {
  it("reuses a chat below the default message cap", () => {
    expect(isReusableChatMessageCount(DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT - 1)).toBe(true);
  });

  it("does not reuse a chat at the default message cap", () => {
    expect(isReusableChatMessageCount(DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT)).toBe(false);
  });

  it("does not reuse a chat over the default message cap", () => {
    expect(isReusableChatMessageCount(DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT + 1)).toBe(false);
  });
});
