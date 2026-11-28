const BOTTOM_CLEARANCE_VAR = "--guest-bottom-clearance";
const BANNER_MAX_WIDTH_PX = 512; // max-w-lg
const BANNER_HORIZONTAL_GAP_PX = 16;
const VERTICAL_GAP_PX = 12;

type RegisteredControl = {
  element: HTMLElement;
  fallbackPx: number;
  checkHorizontalOverlap: boolean;
};

const controls = new Map<string, RegisteredControl>();

function computeControlClearance(entry: RegisteredControl): number {
  if (typeof window === "undefined") return 0;
  const style = window.getComputedStyle(entry.element);
  if (style.display === "none" || style.visibility === "hidden") return 0;

  const rect = entry.element.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) {
    return entry.fallbackPx;
  }

  if (entry.checkHorizontalOverlap && window.innerWidth >= 768) {
    const bannerHalf = Math.min(BANNER_MAX_WIDTH_PX, window.innerWidth - 32) / 2;
    const bannerRight = window.innerWidth / 2 + bannerHalf;
    const bannerLeft = window.innerWidth / 2 - bannerHalf;
    const overlapsHorizontally =
      rect.left < bannerRight + BANNER_HORIZONTAL_GAP_PX &&
      rect.right > bannerLeft - BANNER_HORIZONTAL_GAP_PX;
    if (!overlapsHorizontally) return 0;
  }

  return Math.max(0, Math.ceil(window.innerHeight - rect.top) + VERTICAL_GAP_PX);
}

export function syncGuestBottomClearance() {
  if (typeof document === "undefined") return;
  let maxClearance = 0;
  for (const entry of controls.values()) {
    const clearance = computeControlClearance(entry);
    if (clearance > maxClearance) {
      maxClearance = clearance;
    }
  }
  if (maxClearance > 0) {
    document.documentElement.style.setProperty(BOTTOM_CLEARANCE_VAR, `${maxClearance}px`);
  } else {
    document.documentElement.style.removeProperty(BOTTOM_CLEARANCE_VAR);
  }
}

export function focusGuestAfterConsent() {
  for (const entry of controls.values()) {
    if (computeControlClearance(entry) <= 0) continue;
    const target = entry.element.querySelector<HTMLElement>("a[href], button") ?? entry.element;
    target.focus({ preventScroll: true });
    if (target === document.activeElement) return;
  }
  document.querySelector<HTMLElement>("main[tabindex='-1']")?.focus({ preventScroll: true });
}

export function registerGuestBottomControl(
  id: string,
  element: HTMLElement,
  options: { fallbackPx: number; checkHorizontalOverlap?: boolean },
): () => void {
  controls.set(id, {
    element,
    fallbackPx: options.fallbackPx,
    checkHorizontalOverlap: options.checkHorizontalOverlap ?? false,
  });
  syncGuestBottomClearance();

  const onResize = () => syncGuestBottomClearance();
  window.addEventListener("resize", onResize, { passive: true });
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(onResize);
    observer.observe(element);
  }

  return () => {
    controls.delete(id);
    window.removeEventListener("resize", onResize);
    observer?.disconnect();
    syncGuestBottomClearance();
  };
}
