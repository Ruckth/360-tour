import { describe, expect, it } from "vitest";
import { adminChatVisitorLabel } from "@/components/admin/admin-chat-labels";

describe("adminChatVisitorLabel", () => {
  it("uses explicit visitor identity before fallback ids", () => {
    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorName: "Maya Chen",
        visitorEmail: "maya@example.com",
        visitorContactHandle: "U123",
        visitorId: "line:U123",
      }),
    ).toBe("Maya Chen");

    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorEmail: "maya@example.com",
        visitorContactHandle: "U123",
        visitorId: "line:U123",
      }),
    ).toBe("maya@example.com");
  });

  it("uses external contact handles without visitor wording", () => {
    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorContactHandle: "U123",
        visitorId: "line:U123",
      }),
    ).toBe("U123");

    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorContactHandle: "fb-user-123",
        visitorId: "facebook:fb-user-123",
      }),
    ).toBe("fb-user-123");

    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorContactHandle: "ig-user-123",
        visitorId: "instagram:ig-user-123",
      }),
    ).toBe("ig-user-123");
  });

  it("strips known external visitor id prefixes when no handle exists", () => {
    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorId: "facebook:fb-user-123",
      }),
    ).toBe("fb-user-123");

    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorId: "line:U123",
      }),
    ).toBe("U123");

    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorId: "instagram:ig-user-123",
      }),
    ).toBe("ig-user-123");
  });

  it("shortens web visitor ids without adding visitor wording", () => {
    expect(
      adminChatVisitorLabel({
        _id: "session123456",
        visitorId: "8d4a90ec-e2e3-4f26-9983-63d36404aa27",
      }),
    ).toBe("8d4a90ec");
  });
});
