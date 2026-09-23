import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AdminSessionDetail,
  chronologicalTranscriptMessages,
} from "@/components/admin/AdminChatDashboard";

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
});
