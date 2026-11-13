import type { Page } from "@playwright/test";

/*
 * Counts controls and words the way the click audit did (docs/reviews/ux-audit/click-audit.md on
 * ux/click-audit, tests/browser/ux-audit/measure.ts), so the browser specs can assert its targets.
 * Content of closed <details>, hidden and aria-hidden elements is left out.
 */

const CONTROL_SELECTOR = [
  "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "summary",
  "[role=button]", "[role=link]", "[role=tab]", "[role=radio]", "[role=checkbox]", "[role=switch]",
  "[role=combobox]", "[role=menuitem]", "[role=option]", "[role=slider]", "[contenteditable=true]",
].join(",");

export type Census = {
  /** Controls visible inside the viewport. */
  controlsOnScreen: number;
  /** Controls visible anywhere on the page, including below the fold. */
  controlsOnPage: number;
  wordsOnScreen: number;
  wordsOnPage: number;
};

/** Controls and words inside `scope` (a CSS selector), or the whole page. */
export async function census(page: Page, scope?: string): Promise<Census> {
  return page.evaluate(({ selector, scope }) => {
    const root = (scope ? document.querySelector(scope) : document.body) as HTMLElement | null;
    if (!root) return { controlsOnScreen: 0, controlsOnPage: 0, wordsOnScreen: 0, wordsOnPage: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if ((el as HTMLElement).closest("[aria-hidden=true],[inert]")) return false;
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
    const all = [...(root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll(selector))].filter(
      (el) => visible(el) && (el === root || !el.parentElement?.closest(selector)),
    );
    let wordsOnScreen = 0;
    let wordsOnPage = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const words = (node.textContent ?? "").match(/[\p{L}\p{N}฿%][\p{L}\p{N}฿%.,:'’/-]*/gu);
      if (!words || !node.parentElement || !visible(node.parentElement)) continue;
      if (node.parentElement.closest("style,script,option,select")) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      wordsOnPage += words.length;
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw || clipped(node.parentElement, r)) continue;
      wordsOnScreen += words.length;
    }
    return { controlsOnScreen: all.filter(inView).length, controlsOnPage: all.length, wordsOnScreen, wordsOnPage };
  }, { selector: CONTROL_SELECTOR, scope });
}

/** Counts every user action, so a spec can assert how many taps and typed fields a task takes. */
export class TapCounter {
  taps = 0;
  fields = 0;
  readonly steps: string[] = [];
  tap(label: string) {
    this.taps += 1;
    this.steps.push(`tap: ${label}`);
  }
  field(label: string) {
    this.fields += 1;
    this.steps.push(`field: ${label}`);
  }
}
