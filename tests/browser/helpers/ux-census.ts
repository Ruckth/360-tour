import type { Locator, Page } from "@playwright/test";

/*
 * Counting what a person sees:
 * controls inside the viewport, and whether a target needs a scroll before it can be tapped.
 */

export const UX_VIEWPORTS = {
  ipad: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
} as const;
export type UxViewport = keyof typeof UX_VIEWPORTS;

const CONTROLS = [
  "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "summary",
  "[role=button]", "[role=link]", "[role=tab]", "[role=radio]", "[role=checkbox]", "[role=switch]",
  "[role=combobox]", "[role=menuitem]", "[role=option]", "[role=slider]", "[contenteditable=true]",
].join(",");

/**
 * Visible controls inside the viewport (and not clipped by a scrolling ancestor), in `scope` or the
 * whole page. A control nested in another control counts once.
 */
export function controlsOnScreen(page: Page, scope?: Locator): Promise<number> {
  const count = (root: Element, selector: string) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if (el.closest("[aria-hidden=true],[inert]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const clipped = (el: Element, r: DOMRect) => {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) {
          const p = node.getBoundingClientRect();
          if (r.bottom <= p.top + 1 || r.top >= p.bottom - 1 || r.right <= p.left + 1 || r.left >= p.right - 1) return true;
        }
      }
      return false;
    };
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
      return !clipped(el, r);
    };
    return [...(root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll(selector))]
      .filter((el) => visible(el) && (el === root || !el.parentElement?.closest(selector)))
      .filter(inView).length;
  };
  return scope ? scope.evaluate(count, CONTROLS) : page.locator("body").evaluate(count, CONTROLS);
}

/** Off screen (outside the viewport or its scroller) before the tap: the person would scroll first. */
export function needsScroll(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight + 1 || r.top < -1 || r.right > window.innerWidth + 1 || r.left < -1) return true;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
        const p = node.getBoundingClientRect();
        if (r.bottom > p.bottom + 1 || r.top < p.top - 1) return true;
      }
    }
    return false;
  });
}

/** Counts taps, typed fields and scrolls on a task path. Every step waits for its target first. */
export class TaskCounter {
  taps = 0;
  typed = 0;
  scrolls = 0;
  readonly log: string[] = [];

  private async before(target: Locator, label: string) {
    await target.waitFor({ state: "visible" });
    if (await needsScroll(target)) {
      this.scrolls += 1;
      this.log.push(`scroll before ${label}`);
      await target.scrollIntoViewIfNeeded();
    }
  }

  async tap(target: Locator, label: string) {
    await this.before(target, label);
    await target.click();
    this.taps += 1;
    this.log.push(`tap ${label}`);
  }

  async type(target: Locator, text: string, label: string) {
    await this.before(target, label);
    await target.fill(text);
    this.typed += 1;
    this.log.push(`type ${label}`);
  }
}
