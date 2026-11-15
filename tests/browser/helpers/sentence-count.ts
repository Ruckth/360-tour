/**
 * Returns the visible explanatory sentences inside `root`: text that ends in . ! or ? and has at
 * least 4 words. Text in closed <details> (other than the summary), buttons, form controls, labels, headings, hidden elements and anything
 * under `data-sentence-budget="ignore"` (money, receipt paper) does not count.
 *
 * Self-contained on purpose: Playwright serialises it into the page via `locator.evaluate`.
 */
export function visibleSentences(root: Element): string[] {
  const skip =
    'button, input, textarea, select, option, label, legend, summary, h1, h2, h3, h4, h5, h6, script, style, noscript, template, [role="button"], [role="menuitem"], [role="heading"], [hidden], .sr-only, [data-sentence-budget="ignore"]';
  const inline = new Set([
    "A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DATA", "DFN", "EM", "I", "KBD", "MARK",
    "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR",
  ]);
  const view = root.ownerDocument.defaultView;
  const shown = (el: Element) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (view?.getComputedStyle(node).display === "none") return false;
      // A closed <details> hides everything but its summary (Chromium keeps their display as is).
      const parent = node.parentElement;
      if (parent?.tagName === "DETAILS" && !(parent as HTMLDetailsElement).open && node.tagName !== "SUMMARY") return false;
      if (node === root) break;
    }
    return view?.getComputedStyle(el).visibility !== "hidden";
  };

  const blocks = new Map<Element, string>();
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const parent = text.parentElement;
    if (!parent || !text.textContent?.trim()) continue;
    const ignored = parent.closest(skip);
    if ((ignored && root.contains(ignored)) || !shown(parent)) continue;
    let block: Element = parent;
    while (block !== root && inline.has(block.tagName) && block.parentElement) block = block.parentElement;
    blocks.set(block, (blocks.get(block) ?? "") + text.textContent);
  }

  const sentences: string[] = [];
  for (const raw of blocks.values()) {
    const text = raw.replace(/\s+/g, " ").trim();
    for (const match of text.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []) {
      const sentence = match.trim();
      if (sentence.split(" ").filter(Boolean).length >= 4) sentences.push(sentence);
    }
  }
  return sentences;
}
