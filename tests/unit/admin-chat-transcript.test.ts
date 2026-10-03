import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminSessionDetail, chronologicalTranscriptMessages } from "@/components/admin/AdminSessionDetail";

type DetailProps = Parameters<typeof AdminSessionDetail>[0];

describe("admin transcript", () => {
  it.each([false, true])("renders the newest message beside the reply box (compact: %s)", (compact) => {
    const newestFirst = [
      { _id: "newest", role: "user", content: "Newest guest message", timestamp: 3 },
      { _id: "middle", role: "assistant", content: "Middle reply", timestamp: 2 },
      { _id: "oldest", role: "user", content: "Oldest guest message", timestamp: 1 },
    ] as DetailProps["messages"];
    const props: DetailProps = {
      canLoadOlderMessages: true,
      compact,
      loadOlderMessages: () => {},
      loadingTranscript: false,
      loadingOlderMessages: false,
      messages: chronologicalTranscriptMessages(newestFirst),
      now: 3,
      selectedSession: {
        _id: "session",
        channel: "web",
        createdAt: 1,
        isActive: false,
      } as DetailProps["selectedSession"],
      replyDraft: "",
      onReplyDraftChange: () => {},
      onSendReply: async () => {},
      replyPending: false,
      replyError: null,
      replyStatus: null,
    };

    const html = renderToStaticMarkup(createElement(AdminSessionDetail, props));
    expect(html.indexOf("Oldest guest message")).toBeLessThan(html.indexOf("Middle reply"));
    expect(html.indexOf("Middle reply")).toBeLessThan(html.indexOf("Newest guest message"));
    expect(html.indexOf("Newest guest message")).toBeLessThan(html.indexOf("Type a reply"));
    expect(html.indexOf("Load older messages")).toBeLessThan(html.indexOf("Oldest guest message"));
  });

  it("replaces the composer with the channel window state even on a reopened chat", () => {
    const props: DetailProps = {
      canLoadOlderMessages: false,
      loadOlderMessages: () => {},
      loadingTranscript: false,
      loadingOlderMessages: false,
      messages: [],
      now: 100,
      selectedSession: {
        _id: "session",
        channel: "whatsapp",
        createdAt: 1,
        isActive: false,
        adminStatus: "open",
      } as DetailProps["selectedSession"],
      replyDraft: "An unsent draft",
      onReplyDraftChange: () => {},
      onSendReply: async () => {},
      replyPending: false,
      replyError: null,
      replyStatus: null,
      replyWindow: { applies: true, closesAt: 99, lastGuestMessageAt: 1 },
    };
    const html = renderToStaticMarkup(createElement(AdminSessionDetail, props));
    expect(html).toContain("WhatsApp reply window has ended");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="submit"');
  });

  it("does not treat offline presence as a closed reply window", () => {
    const props: DetailProps = {
      canLoadOlderMessages: false,
      loadOlderMessages: () => {},
      loadingTranscript: false,
      loadingOlderMessages: false,
      messages: [],
      now: 100,
      selectedSession: {
        _id: "session",
        channel: "web",
        createdAt: 1,
        isActive: false,
      } as DetailProps["selectedSession"],
      replyDraft: "A reply",
      onReplyDraftChange: () => {},
      onSendReply: async () => {},
      replyPending: false,
      replyError: null,
      replyStatus: null,
      replyWindow: { applies: false },
    };
    const html = renderToStaticMarkup(createElement(AdminSessionDetail, props));
    expect(html).toContain("<textarea");
    expect(html).not.toContain("reply window has ended");
    expect(html).not.toContain('disabled=""');
  });

  it("puts the guest on the left and labels AI and staff replies differently", () => {
    const props: DetailProps = {
      canLoadOlderMessages: false,
      loadOlderMessages: () => {},
      loadingTranscript: false,
      loadingOlderMessages: false,
      messages: [
        { _id: "guest", role: "user", content: "Is the pool heated?", timestamp: 1 },
        { _id: "ai", role: "assistant", content: "Yes, all year.", timestamp: 2 },
        { _id: "staff", role: "assistant", source: "admin", content: "Happy to help!", timestamp: 3 },
      ] as DetailProps["messages"],
      now: 3,
      selectedSession: {
        _id: "session",
        channel: "web",
        createdAt: 1,
        isActive: false,
      } as DetailProps["selectedSession"],
      replyDraft: "",
      onReplyDraftChange: () => {},
      onSendReply: async () => {},
      replyPending: false,
      replyError: null,
      replyStatus: null,
    };

    const html = renderToStaticMarkup(createElement(AdminSessionDetail, props));
    const bubble = (author: string) =>
      html.slice(html.indexOf(`data-author="${author}"`) - 200, html.indexOf(`data-author="${author}"`));
    expect(bubble("guest")).toContain("mr-auto");
    expect(bubble("ai")).toContain("ml-auto");
    expect(bubble("staff")).toContain("ml-auto");
    expect(html).toContain(">AI</span>");
    expect(html).toContain(">Staff</span>");
    expect(html).toContain(">Web guest</span>");
  });
});
