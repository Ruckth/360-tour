import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampKeyboardInset,
  getKeyboardLayoutMeasurement,
  getKeyboardOverlayFallbackInset,
  getKeyboardViewportBaselineHeight,
  isKeyboardOverlayBrowser,
  MOBILE_KEYBOARD_THRESHOLD,
} from "@/components/chat/session/keyboard-viewport";

type FakeWindow = {
  innerHeight: number;
  visualViewport?: { height: number; offsetTop: number };
};

function stubWindow(win: FakeWindow, userAgent = "") {
  vi.stubGlobal("window", win as unknown as Window);
  vi.stubGlobal("navigator", { userAgent } as unknown as Navigator);
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isKeyboardOverlayBrowser", () => {
  it("detects known in-app browsers from the user agent", () => {
    stubWindow({ innerHeight: 760 }, "Instagram 300.0 Android");
    expect(isKeyboardOverlayBrowser()).toBe(true);
  });

  it("returns false for a normal mobile browser", () => {
    stubWindow({ innerHeight: 760 }, "Mozilla/5.0 iPhone Safari");
    expect(isKeyboardOverlayBrowser()).toBe(false);
  });
});

describe("clampKeyboardInset", () => {
  it("floors at zero and ceilings proportional to viewport height", () => {
    stubWindow({ innerHeight: 800 });
    expect(clampKeyboardInset(-10)).toBe(0);
    // Max is max(440, round(800*0.7)=560) => 560.
    expect(clampKeyboardInset(900)).toBe(560);
    expect(clampKeyboardInset(120.2)).toBe(121);
  });
});

describe("getKeyboardViewportBaselineHeight", () => {
  it("uses the larger of innerHeight and visualViewport height", () => {
    stubWindow({ innerHeight: 760, visualViewport: { height: 500, offsetTop: 0 } });
    expect(getKeyboardViewportBaselineHeight()).toBe(760);
    stubWindow({ innerHeight: 500, visualViewport: { height: 760, offsetTop: 0 } });
    expect(getKeyboardViewportBaselineHeight()).toBe(760);
  });
});

describe("getKeyboardOverlayFallbackInset", () => {
  it("stays within the configured min/max bounds", () => {
    stubWindow({ innerHeight: 400 }); // 400*0.43=172 -> clamped up to min 280
    expect(getKeyboardOverlayFallbackInset()).toBe(280);
    stubWindow({ innerHeight: 2000 }); // -> clamped down to max 440
    expect(getKeyboardOverlayFallbackInset()).toBe(440);
  });
});

describe("getKeyboardLayoutMeasurement", () => {
  it("reports no inset when no input is focused and the viewport is full", () => {
    stubWindow({ innerHeight: 760, visualViewport: { height: 760, offsetTop: 0 } });
    expect(
      getKeyboardLayoutMeasurement({
        fallbackAllowed: false,
        focusedInputIsActive: false,
        footerNode: null,
        inputNode: null,
        mode: "page",
        viewportBaselineHeight: 760,
      }),
    ).toEqual({ inset: 0, layoutMode: "none" });
  });

  it("reports a resized viewport in page mode when the keyboard shrinks it", () => {
    stubWindow({ innerHeight: 760, visualViewport: { height: 500, offsetTop: 0 } });
    const result = getKeyboardLayoutMeasurement({
      fallbackAllowed: false,
      focusedInputIsActive: true,
      footerNode: null,
      inputNode: null,
      mode: "page",
      viewportBaselineHeight: 760,
    });
    expect(result.layoutMode).toBe("resizedViewport");
    expect(result.inset).toBe(0);
  });

  it("uses the overlay fallback inset for an in-app browser with no real inset", () => {
    stubWindow({ innerHeight: 760, visualViewport: { height: 760, offsetTop: 0 } });
    const result = getKeyboardLayoutMeasurement({
      fallbackAllowed: true,
      focusedInputIsActive: true,
      footerNode: null,
      inputNode: null,
      mode: "page",
      viewportBaselineHeight: 760,
    });
    expect(result.layoutMode).toBe("overlayFallback");
    expect(result.inset).toBeGreaterThan(MOBILE_KEYBOARD_THRESHOLD);
  });
});
