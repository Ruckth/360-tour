/**
 * Viewport / keyboard measurement.
 *
 * Pure measurement helpers for the mobile-keyboard layout logic. These read the
 * DOM / `window` but hold no state, start no timers and register no listeners —
 * the hook owns the resize/visualViewport listeners and the React state that
 * stores the computed inset. Keeping the arithmetic here makes the layout
 * decisions independently testable with injected numbers.
 */

export type ChatExperienceMode = "overlay" | "page";

export type KeyboardLayoutMode =
  | "none"
  | "resizedViewport"
  | "overlayInset"
  | "overlayFallback";

export const MOBILE_KEYBOARD_THRESHOLD = 80;
export const CHAT_PAGE_HEADER_OFFSET = 0;
export const CHAT_PAGE_MIN_HEIGHT = 360;
export const CHAT_PAGE_VIEWPORT_FALLBACK = "100svh";
export const PAGE_COMPOSER_RESERVE_FALLBACK = 84;
export const IN_APP_KEYBOARD_FALLBACK_RATIO = 0.43;
export const IN_APP_KEYBOARD_FALLBACK_MIN = 280;
export const IN_APP_KEYBOARD_FALLBACK_MAX = 440;
export const KEYBOARD_SAFE_GAP = 16;
export const KEYBOARD_INSET_EPSILON = 8;
export const KEYBOARD_PROBE_DELAYS_MS = [80, 180, 360, 600] as const;
export const KEYBOARD_OVERLAY_BROWSER_PATTERN =
  /Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|TikTok|TwitterAndroid|;\s?wv\)/i;

export function isKeyboardOverlayBrowser() {
  if (typeof navigator === "undefined") return false;
  return KEYBOARD_OVERLAY_BROWSER_PATTERN.test(navigator.userAgent);
}

export function getKeyboardOverlayFallbackInset() {
  if (typeof window === "undefined") return 0;
  return Math.min(
    IN_APP_KEYBOARD_FALLBACK_MAX,
    Math.max(
      IN_APP_KEYBOARD_FALLBACK_MIN,
      Math.round(window.innerHeight * IN_APP_KEYBOARD_FALLBACK_RATIO),
    ),
  );
}

export function getVisualViewportHeight() {
  if (typeof window === "undefined") return 0;
  return window.visualViewport?.height ?? window.innerHeight;
}

export function getKeyboardViewportBaselineHeight() {
  if (typeof window === "undefined") return 0;
  return Math.max(window.innerHeight, getVisualViewportHeight());
}

export function isKeyboardInputElement(
  element: Element | null,
): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  return element.matches("input, textarea, [contenteditable='true']");
}

export function getFocusedFooterInput(footerNode: HTMLElement | null) {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement;
  if (
    !footerNode?.contains(activeElement) ||
    !isKeyboardInputElement(activeElement)
  ) {
    return null;
  }

  return activeElement;
}

export function clampKeyboardInset(inset: number) {
  if (typeof window === "undefined") return inset;
  const maxInset = Math.max(
    IN_APP_KEYBOARD_FALLBACK_MAX,
    Math.round(window.innerHeight * 0.7),
  );
  return Math.min(Math.max(0, Math.ceil(inset)), maxInset);
}

export function getKeyboardLayoutMeasurement({
  fallbackAllowed,
  focusedInputIsActive,
  footerNode,
  inputNode,
  mode,
  viewportBaselineHeight,
}: {
  fallbackAllowed: boolean;
  focusedInputIsActive: boolean;
  footerNode: HTMLElement | null;
  inputNode: HTMLElement | null;
  mode: ChatExperienceMode;
  viewportBaselineHeight: number | null;
}): { inset: number; layoutMode: KeyboardLayoutMode } {
  if (typeof window === "undefined") return { inset: 0, layoutMode: "none" };

  const visualViewport = window.visualViewport;
  const visualViewportHeight = getVisualViewportHeight();
  const visibleViewportBottom =
    (visualViewport?.offsetTop ?? 0) + visualViewportHeight;
  const realInset = Math.max(
    0,
    Math.round(window.innerHeight - visibleViewportBottom),
  );
  const viewportShrink = viewportBaselineHeight
    ? Math.max(0, Math.round(viewportBaselineHeight - visualViewportHeight))
    : 0;
  const viewportResizedByKeyboard = viewportShrink > MOBILE_KEYBOARD_THRESHOLD;

  if (!focusedInputIsActive) {
    return realInset > MOBILE_KEYBOARD_THRESHOLD
      ? { inset: clampKeyboardInset(realInset), layoutMode: "overlayInset" }
      : { inset: 0, layoutMode: "none" };
  }

  if (mode === "page" && viewportResizedByKeyboard) {
    return { inset: 0, layoutMode: "resizedViewport" };
  }

  if (mode !== "page") {
    return realInset > MOBILE_KEYBOARD_THRESHOLD
      ? { inset: clampKeyboardInset(realInset), layoutMode: "overlayInset" }
      : { inset: 0, layoutMode: "none" };
  }

  const inputBottom = inputNode?.getBoundingClientRect().bottom ?? 0;
  const footerBottom = footerNode?.getBoundingClientRect().bottom ?? 0;
  const requiredLift = Math.max(
    0,
    Math.ceil(
      Math.max(inputBottom, footerBottom) -
        visibleViewportBottom +
        KEYBOARD_SAFE_GAP,
    ),
  );
  const overlayFallback =
    realInset <= MOBILE_KEYBOARD_THRESHOLD && fallbackAllowed;
  const estimatedInset = overlayFallback
    ? getKeyboardOverlayFallbackInset()
    : 0;
  const inset = clampKeyboardInset(
    Math.max(realInset, requiredLift, estimatedInset),
  );

  if (inset <= MOBILE_KEYBOARD_THRESHOLD)
    return { inset: 0, layoutMode: "none" };
  return {
    inset,
    layoutMode:
      overlayFallback && estimatedInset >= Math.max(realInset, requiredLift)
        ? "overlayFallback"
        : "overlayInset",
  };
}
