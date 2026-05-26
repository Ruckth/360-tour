import { describe, expect, it } from "vitest";
import {
  appendChatExternalParams,
  buildExternalBrowserTarget,
  detectChatInAppBrowser,
  shouldBypassChatBrowserGate,
  stripChatHandoffParam,
} from "@/lib/chat/external-browser";

describe("chat external browser helpers", () => {
  it("detects supported mobile in-app browsers", () => {
    expect(
      detectChatInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 333.0.0.0.0 Android",
      ),
    ).toMatchObject({ isInAppBrowser: true, kind: "instagram", platform: "android" });

    expect(
      detectChatInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 Line/14.0.0",
      ),
    ).toMatchObject({ isInAppBrowser: true, kind: "line", platform: "ios" });

    expect(
      detectChatInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36",
      ),
    ).toMatchObject({ isInAppBrowser: true, kind: "android-webview" });
  });

  it("does not gate desktop or normal mobile Chrome", () => {
    expect(
      detectChatInAppBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
      ).isInAppBrowser,
    ).toBe(false);

    expect(
      detectChatInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      ).isInAppBrowser,
    ).toBe(false);
  });

  it("builds Android Chrome intent URLs with external and handoff params", () => {
    const browserUrl = appendChatExternalParams("https://example.com/chat?property=pool", {
      handoffToken: "token123",
    });
    const target = buildExternalBrowserTarget(
      browserUrl,
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram",
    );

    expect(browserUrl).toBe("https://example.com/chat?property=pool&external=1&handoff=token123");
    expect(target.platform).toBe("android");
    expect(target.url).toContain("intent://example.com/chat?property=pool&external=1&handoff=token123#Intent;");
    expect(target.url).toContain("package=com.android.chrome");
  });

  it("builds iOS Chrome URLs and strips claimed handoff params", () => {
    const target = buildExternalBrowserTarget(
      "https://example.com/th/chat?external=1&handoff=token123",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 Line/14.0.0",
    );

    expect(target).toEqual({
      platform: "ios",
      url: "googlechromes://example.com/th/chat?external=1&handoff=token123",
    });
    expect(stripChatHandoffParam("/th/chat?external=1&handoff=token123")).toBe(
      "/th/chat?external=1",
    );
  });

  it("bypasses the gate for explicit external or continue-in-app flags", () => {
    expect(shouldBypassChatBrowserGate(new URLSearchParams("external=1"))).toBe(true);
    expect(shouldBypassChatBrowserGate(new URLSearchParams("continueInApp=1"))).toBe(true);
    expect(shouldBypassChatBrowserGate(new URLSearchParams("external=0"))).toBe(false);
  });
});
