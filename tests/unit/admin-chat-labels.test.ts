import { describe, expect, it } from "vitest";
import { adminChatVisitorLabel } from "@/components/admin/admin-chat-labels";

describe("adminChatVisitorLabel", () => {
  it("uses the stored name, then email", () => {
    expect(
      adminChatVisitorLabel({
        channel: "line",
        visitorName: "Maya Chen",
        visitorEmail: "maya@example.com",
        visitorContactHandle: "U123",
      }),
    ).toBe("Maya Chen");

    expect(
      adminChatVisitorLabel({
        channel: "line",
        visitorEmail: "maya@example.com",
        visitorContactHandle: "U123",
      }),
    ).toBe("maya@example.com");
  });

  it("falls back to a channel guest label instead of raw platform ids", () => {
    expect(adminChatVisitorLabel({ channel: "line", visitorContactHandle: "U123" })).toBe("LINE guest");
    expect(adminChatVisitorLabel({ channel: "facebook", visitorContactHandle: "fb-user-123" })).toBe(
      "Facebook guest",
    );
    expect(adminChatVisitorLabel({ channel: "instagram", visitorContactHandle: "ig-user-123" })).toBe(
      "Instagram guest",
    );
    expect(adminChatVisitorLabel({ channel: "whatsapp", visitorContactHandle: "66956823432" })).toBe(
      "WhatsApp guest",
    );
    expect(adminChatVisitorLabel({ channel: "web" })).toBe("Web guest");
  });

  it("uses a web visitor's self-entered contact handle", () => {
    expect(adminChatVisitorLabel({ channel: "web", visitorContactHandle: "@maya" })).toBe("@maya");
  });
});
