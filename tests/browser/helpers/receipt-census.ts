import type { Page } from "@playwright/test";

/*
 * The receipt counts the plan sets for P4 (docs/plans/ux-simplification-plan.md): words on screen
 * outside the receipt paper, and the blocks in the column beside it. Works on the receipt before
 * and after P4, so both sets of screenshots are measured the same way.
 */

export type ReceiptCensus = {
  /** Words inside the viewport, in the receipt screen but outside `.pos-receipt`. */
  wordsOutsidePaper: number;
  /** Visible blocks in the side column; a plain <section> counts as its visible children. */
  sideBlocks: number;
};

export function receiptCensus(page: Page): Promise<ReceiptCensus> {
  return page.evaluate(() => {
    const paper = document.querySelector(".pos-receipt");
    const root = document.querySelector('[data-testid="receipt-view"]') ?? paper?.closest(".overflow-y-auto > *");
    if (!paper || !root) return { wordsOutsidePaper: -1, sideBlocks: -1 };
    const visible = (el: Element) => {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if (el.closest("[aria-hidden=true],[inert]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let words = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(".pos-receipt,style,script,option,select,.sr-only")) continue;
      const found = (node.textContent ?? "").match(/[\p{L}\p{N}฿%][\p{L}\p{N}฿%.,:'’/-]*/gu);
      if (!found || !visible(parent)) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      words += found.length;
    }
    const side = document.querySelector('[data-testid="receipt-side"]') ?? root.lastElementChild;
    let blocks = 0;
    for (const child of Array.from(side?.children ?? [])) {
      if (!visible(child)) continue;
      blocks += child.tagName === "SECTION" ? Array.from(child.children).filter(visible).length : 1;
    }
    return { wordsOutsidePaper: words, sideBlocks: blocks };
  });
}
