import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

/*
 * Measurement helpers for the click audit. Every user action goes through a Recorder, which counts it
 * and notes whether the target was off screen first (a scroll the user would have to make).
 */

// Run from the repo root (see playwright.ux.config.ts).
export const ROOT = process.cwd();
export const SCREENS = path.join(ROOT, "docs/reviews/ux-audit/screens");
export const RESULTS = path.join(ROOT, "docs/reviews/ux-audit/results");
/** The re-run on ux/integration (final-audit.md) writes beside the original, never over it. */
export const FINAL_SCREENS = path.join(ROOT, "docs/reviews/ux-audit/final-screens");
export const FINAL_RESULTS = path.join(ROOT, "docs/reviews/ux-audit/results-final");
for (const dir of [SCREENS, RESULTS, FINAL_SCREENS, FINAL_RESULTS]) mkdirSync(dir, { recursive: true });
export type Out = { screens: string; results: string };

export const VIEWPORTS = {
  ipad: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

const CONTROL_SELECTOR = [
  "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "summary",
  "[role=button]", "[role=link]", "[role=tab]", "[role=radio]", "[role=checkbox]", "[role=switch]",
  "[role=combobox]", "[role=menuitem]", "[role=option]", "[role=slider]", "[contenteditable=true]",
].join(",");

export type Census = {
  /** Interactive controls visible inside the viewport right now. */
  controlsOnScreen: number;
  /** Interactive controls rendered and visible anywhere on the page (reachable by scrolling). */
  controlsOnPage: number;
  /** Words whose text box lies inside the viewport. */
  wordsOnScreen: number;
  /** Words in visible text boxes anywhere on the page (reachable by scrolling; screen-reader-only text left out). */
  wordsOnPage: number;
  /** Words in innerText, which also counts screen-reader-only text. */
  wordsInnerText: number;
};

/** Counts controls and words, inside `scope` (a CSS selector) or the whole page. */
export async function census(page: Page, scope?: string, index = 0): Promise<Census> {
  return page.evaluate(({ selector, scope, index }) => {
    const root = (scope ? document.querySelectorAll(scope)[index] : document.body) as HTMLElement | null;
    if (!root) return { controlsOnScreen: 0, controlsOnPage: 0, wordsOnScreen: 0, wordsOnPage: 0, wordsInnerText: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      // checkVisibility also hides the content of closed <details> (content-visibility: hidden).
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if ((el as HTMLElement).closest("[aria-hidden=true],[inert]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    // Clipped by a scrolling ancestor: not on screen even if inside the viewport.
    const clipped = (el: Element, r: DOMRect) => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) {
          const p = node.getBoundingClientRect();
          if (r.bottom <= p.top + 1 || r.top >= p.bottom - 1 || r.right <= p.left + 1 || r.left >= p.right - 1) return true;
        }
        node = node.parentElement;
      }
      return false;
    };
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
      return !clipped(el, r);
    };
    // A control nested in another control counts once (e.g. a role=option button inside a list item button).
    const all = [...(root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll(selector))].filter((el) => visible(el) && (el === root || !el.parentElement?.closest(selector)));
    const controlsOnPage = all.length;
    const controlsOnScreen = all.filter(inView).length;
    const wordsInnerText = (root.innerText.match(/[\p{L}\p{N}฿%][\p{L}\p{N}฿%.,:'’/-]*/gu) ?? []).length;
    let wordsOnScreen = 0;
    let wordsOnPage = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const words = text.match(/[\p{L}\p{N}฿%][\p{L}\p{N}฿%.,:'’/-]*/gu);
      if (!words || !node.parentElement || !visible(node.parentElement)) continue;
      if (node.parentElement.closest("style,script,option,select")) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      wordsOnPage += words.length;
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      if (clipped(node.parentElement, r)) continue;
      wordsOnScreen += words.length;
    }
    return { controlsOnScreen, controlsOnPage, wordsOnScreen, wordsOnPage, wordsInnerText };
  }, { selector: CONTROL_SELECTOR, scope, index });
}

/** Lists the visible controls on screen by role and name: for the audit's notes. */
export async function listControls(page: Page, scope?: string) {
  return page.evaluate(({ selector, scope }) => {
    const root = (scope ? document.querySelector(scope) : document.body) as HTMLElement;
    return Array.from(root.querySelectorAll(selector))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !el.closest("[aria-hidden=true],[inert]") && !el.parentElement?.closest(selector); })
      .map((el) => {
        const r = el.getBoundingClientRect();
        const name = (el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? el.getAttribute("placeholder") ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} "${name}" @${Math.round(r.top)}`;
      });
  }, { selector: CONTROL_SELECTOR, scope });
}

/** Controls and words for named regions of a page, heaviest first. */
export async function componentCensus(page: Page, regions: Record<string, { selector: string; file: string }>) {
  const rows: { component: string; file: string; controls: number; words: number }[] = [];
  for (const [component, { selector, file }] of Object.entries(regions)) {
    const c = await census(page, selector);
    if (c.controlsOnPage === 0 && c.wordsOnPage === 0) continue;
    rows.push({ component, file, controls: c.controlsOnPage, words: c.wordsOnPage });
  }
  return rows.sort((a, b) => b.controls + b.words / 10 - (a.controls + a.words / 10));
}

type Step = { kind: "tap" | "type" | "key"; label: string; scrolled: boolean; decision: boolean; choices: number };

export class Recorder {
  steps: Step[] = [];
  notes: string[] = [];
  start?: Census;
  /** Explanatory sentences visible at the start (helpers/sentence-count.ts), when a counter is given. */
  startSentences?: string[];
  shots: string[] = [];
  constructor(
    private page: Page,
    readonly task: string,
    readonly viewport: ViewportName,
    private out: Out = { screens: SCREENS, results: RESULTS },
    private sentences?: (page: Page, scope?: string) => Promise<string[]>,
  ) {}

  /** Off screen (outside the viewport or clipped by its scroller) or covered: the user must scroll first. */
  private async needsScroll(target: Locator) {
    return target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight + 1 || r.top < -1 || r.right > window.innerWidth + 1 || r.left < -1) return true;
      let node = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (/(auto|scroll)/.test(s.overflowY)) {
          const p = node.getBoundingClientRect();
          if (r.bottom > p.bottom + 1 || r.top < p.top - 1) return true;
        }
        node = node.parentElement;
      }
      return false;
    });
  }

  private async act(kind: Step["kind"], target: Locator, label: string, decision: boolean, run: () => Promise<void>) {
    await target.waitFor({ state: "visible" });
    const scrolled = await this.needsScroll(target);
    const choices = decision ? (await census(this.page)).controlsOnScreen : 0;
    if (scrolled) await target.scrollIntoViewIfNeeded();
    await run();
    this.steps.push({ kind, label, scrolled, decision, choices });
  }

  async begin() {
    this.start = await census(this.page);
    if (this.sentences) this.startSentences = await this.sentences(this.page);
    await this.shot("start");
  }
  tap(target: Locator, label: string, opts: { decision?: boolean } = {}) {
    return this.act("tap", target, label, opts.decision ?? false, () => target.click());
  }
  /** A <select>: one tap to open and one to pick. */
  async pick(target: Locator, value: string, label: string) {
    await this.act("tap", target, `${label} (open)`, false, async () => {});
    await this.act("tap", target, `${label} (pick)`, true, async () => { await target.selectOption(value); });
  }
  type(target: Locator, text: string, label: string) {
    return this.act("type", target, label, false, () => target.fill(text));
  }
  key(target: Locator, key: string, label: string) {
    return this.act("key", target, label, false, () => target.press(key));
  }
  note(text: string) { this.notes.push(text); }
  /** Census at a key step, kept with the result. */
  async measure(label: string, scope?: string) {
    const sentences = this.sentences ? await this.sentences(this.page, scope) : undefined;
    this.checkpoints.push({ label, ...(await census(this.page, scope)), ...(sentences ? { sentences: sentences.length, sentenceText: sentences } : {}) });
  }
  checkpoints: ({ label: string; sentences?: number; sentenceText?: string[] } & Census)[] = [];
  /** For planning: the controls on screen now, written next to the results. */
  async dump(name: string) {
    const file = path.join(this.out.results, `dump-${this.task}-${this.viewport}-${name}.txt`);
    writeFileSync(file, (await listControls(this.page)).join("\n"));
  }
  async shot(name: string) {
    const file = `${this.task}-${this.viewport}-${String(this.shots.length).padStart(2, "0")}-${name}.png`;
    await this.page.screenshot({ path: path.join(this.out.screens, file) });
    this.shots.push(file);
  }
  summary() {
    return {
      task: this.task,
      viewport: this.viewport,
      taps: this.steps.filter((s) => s.kind === "tap").length,
      fields: this.steps.filter((s) => s.kind === "type").length,
      keys: this.steps.filter((s) => s.kind === "key").length,
      decisions: this.steps.filter((s) => s.decision).length,
      scrolls: this.steps.filter((s) => s.scrolled).length,
      start: this.start,
      startSentences: this.startSentences,
      checkpoints: this.checkpoints,
      steps: this.steps,
      notes: this.notes,
      shots: this.shots,
    };
  }
  save() {
    writeFileSync(path.join(this.out.results, `${this.task}-${this.viewport}.json`), JSON.stringify(this.summary(), null, 2));
  }
}
