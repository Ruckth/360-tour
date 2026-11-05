import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { THRESHOLDS } from "./config.ts";
import type { Device } from "./config.ts";
import type { Check, Offender } from "./types.ts";

/** Runs without closure dependencies so Playwright can serialize it into the page. */
export function measureDOM({
  touch,
  phone,
  t,
}: {
  touch: boolean;
  phone: boolean;
  t: typeof THRESHOLDS;
}): Check[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
  const visible = (el: Element, includeAriaHidden = false) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      // Screen-reader-only text (Tailwind's sr-only: a 1px clipped box) isn't on screen.
      r.width > 1 &&
      r.height > 1 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      Number(s.opacity) !== 0 &&
      !el.closest("[inert],nextjs-portal") &&
      // Content of a closed <details> keeps a layout box but isn't shown.
      !el.closest("details:not([open]) > :not(summary)") &&
      (includeAriaHidden || !el.closest('[aria-hidden="true"]'))
    );
  };
  const selector = (el: Element): string => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parent = el.parentElement;
    return parent
      ? selector(parent) +
          " > " +
          el.tagName.toLowerCase() +
          `:nth-child(${Array.from(parent.children).indexOf(el) + 1})`
      : el.tagName.toLowerCase();
  };
  const result = (id: string): Check => ({
    id,
    pass: true,
    value: 0,
    total: 0,
    offenders: [],
    exempted: [],
  });
  const add = (check: Check, el: Element, detail: string) => {
    const r = el.getBoundingClientRect();
    const o = {
      selector: selector(el),
      text: (
        el.textContent?.trim() ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        ""
      ).slice(0, 160),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      detail,
    };
    let ancestor: Element | null = el;
    while (ancestor) {
      if (ancestor.getAttribute("data-ui-exempt")?.startsWith(check.id + ":")) {
        o.detail += "; " + ancestor.getAttribute("data-ui-exempt");
        check.exempted.push(o);
        return;
      }
      ancestor = ancestor.parentElement;
    }
    check.total++;
    check.pass = false;
    if (check.offenders.length < t.offenderLimit) check.offenders.push(o);
  };
  const targets = result("targets"),
    overflow = result("overflow"),
    fonts = result("font_min"),
    inputs = result("input_16"),
    truncation = result("truncation"),
    cls = result("cls"),
    contrast = result("contrast");
  const nodes = all.filter((el) => visible(el));
  const size = touch ? t.targetTouch : t.targetMouse;
  for (const el of nodes.filter((el) =>
    el.matches(
      'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="menuitem"],[tabindex]:not([tabindex="-1"])',
    ),
  )) {
    if (
      el.matches(':disabled,[aria-disabled="true"]') ||
      el.closest(':disabled,[aria-disabled="true"]')
    )
      continue;
    const r = el.getBoundingClientRect(),
      cx = r.x + r.width / 2,
      cy = r.y + r.height / 2;
    // Only the part of the target its scrolling ancestors show: a row half scrolled out of its
    // list is not a small target.
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let a = el.parentElement; a; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (
        !/hidden|clip|auto|scroll/.test(
          st.overflow + st.overflowX + st.overflowY,
        )
      )
        continue;
      const ar = a.getBoundingClientRect();
      clip.left = Math.max(clip.left, ar.left);
      clip.top = Math.max(clip.top, ar.top);
      clip.right = Math.min(clip.right, ar.right);
      clip.bottom = Math.min(clip.bottom, ar.bottom);
    }
    // Something pinned over the page (tab bar, cart pill, sticky header) covers a target at this
    // scroll position; it doesn't make the target smaller.
    const pinnedOver = (hit: Element) => {
      for (
        let a: Element | null = hit;
        a && !a.contains(el);
        a = a.parentElement
      )
        if (/fixed|sticky/.test(getComputedStyle(a).position)) return true;
      return false;
    };
    // Edge midpoints of the size×size box: hit testing follows border-radius, so the corners of
    // a rounded 44px button are outside it even though the button is 44px.
    const probes = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]
      .map(([x, y]) => [cx + x * (size / 2 - 0.5), cy + y * (size / 2 - 0.5)])
      .filter(
        ([x, y]) =>
          x >= clip.left && y >= clip.top && x < clip.right && y < clip.bottom,
      );
    if (
      probes.some(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !hit || (!el.contains(hit) && !pinnedOver(hit));
      })
    )
      add(targets, el, `${size}×${size} hit area misses target at an edge`);
  }
  const pageOverflow = Math.max(
    0,
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (pageOverflow > t.overflow)
    add(overflow, document.documentElement, `Page overflow ${pageOverflow}px`);
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.right <= innerWidth + 1 && r.left >= -1) continue;
    let ancestor = el.parentElement;
    let clipped = false;
    while (ancestor && ancestor !== document.body) {
      if (
        /auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowX)
      ) {
        clipped = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (!clipped)
      add(
        overflow,
        el,
        "Extends beyond viewport without a clipping or scrolling ancestor",
      );
  }
  overflow.value = { pagePixels: pageOverflow, offenders: overflow.total };
  const pairs = new Set<string>();
  let smallTouch = 0;
  const textElements = new Set<HTMLElement>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim()) continue;
    const el = node.parentElement;
    if (!el || !visible(el) || el.closest("script,style,noscript")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (
      !Array.from(range.getClientRects()).some(
        (r) =>
          r.bottom > 0 &&
          r.top < innerHeight &&
          r.right > 0 &&
          r.left < innerWidth,
      )
    )
      continue;
    textElements.add(el);
    const s = getComputedStyle(el),
      px = parseFloat(s.fontSize);
    pairs.add(`${px}/${s.fontWeight}`);
    if (px < t.fontMin) add(fonts, el, `Text ${px}px < ${t.fontMin}px`);
    if (touch && px < t.fontTouchWarning) smallTouch++;
  }
  fonts.value = {
    belowMinimum: fonts.total,
    distinctSizeWeightPairs: pairs.size,
    pairs: [...pairs],
  };
  fonts.warnings = [
    { below13Touch: smallTouch, tooManyPairs: pairs.size > t.fontPairsWarning },
  ];
  for (const el of nodes.filter((e) =>
    e.matches(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]),textarea,select,[contenteditable="true"]',
    ),
  )) {
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < t.inputPhone) {
      if (phone) add(inputs, el, `Input font ${px}px < ${t.inputPhone}px`);
      else if (touch)
        (inputs.warnings ??= []).push({ selector: selector(el), fontSize: px });
    }
  }
  // The part of `rect` left visible by the element itself and its clipping ancestors.
  const visibleRect = (el: Element, rect: DOMRect) => {
    let { left, top, right, bottom } = rect;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (
        !/hidden|clip|auto|scroll/.test(
          st.overflow + st.overflowX + st.overflowY,
        )
      )
        continue;
      const r = a.getBoundingClientRect();
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };
  const ownText = (el: Element) =>
    [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
    );
  let allowed = 0;
  for (const el of nodes) {
    const s = getComputedStyle(el);
    const clampsX =
      /hidden|clip/.test(s.overflow + s.overflowX) ||
      s.textOverflow === "ellipsis";
    const clampsY = /hidden|clip/.test(s.overflow + s.overflowY);
    // Only elements that hold the text themselves, or ellipsize/clamp it: a clipping container
    // around other blocks (a card, a pane with its own scroller) is not a truncation.
    if (
      !el.textContent?.trim() ||
      (!clampsX && !clampsY && s.webkitLineClamp === "none") ||
      (!ownText(el) &&
        s.textOverflow !== "ellipsis" &&
        s.webkitLineClamp === "none")
    )
      continue;
    // Vertically, compare where the text actually is with the padding box: a 20px line centred in
    // a 32px row with 8px padding overflows the content box but is not cut off.
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect(),
      box = el.getBoundingClientRect();
    const padTop = box.top + parseFloat(s.borderTopWidth),
      padBottom = box.bottom - parseFloat(s.borderBottomWidth);
    const clipped =
      (clampsX && el.scrollWidth > el.clientWidth + 1) ||
      (s.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1) ||
      (clampsY &&
        text.height > 0 &&
        (text.bottom > padBottom + 1 || text.top < padTop - 1));
    if (clipped) {
      const fullText =
        el.getAttribute("title") || el.getAttribute("aria-label");
      const isAllowed =
        s.textOverflow === "ellipsis" &&
        !!el.closest('li,tr,td,[role="row"],[data-session-id]') &&
        !!fullText &&
        fullText.trim().includes(el.textContent.trim());
      if (isAllowed) allowed++;
      else
        add(
          truncation,
          el,
          "Text is clipped or truncated without a full-text label in a list row or table cell",
        );
    }
    if (
      /[\u0e00-\u0e7f\uac00-\ud7af]/.test(el.textContent) &&
      parseFloat(s.lineHeight) < 1.4 * parseFloat(s.fontSize)
    )
      add(
        truncation,
        el,
        "Thai/Korean text has clipping overflow and line height below 1.4× font size",
      );
  }
  // Direct text ranges avoid treating a card/container as a collision with every child.
  const boxes = [...textElements]
    .flatMap((el) => {
      const range = document.createRange();
      const fragments = [];
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
          range.selectNode(n);
          // A wrapped inline has one rectangle per line. Its bounding rectangle includes
          // empty space between the fragments, which can contain a neighbouring label.
          for (const rect of range.getClientRects())
            fragments.push({ el, rect: visibleRect(el, rect) });
        }
      }
      return fragments;
    })
    .filter((b) => b.rect.width && b.rect.height);
  const pinned = (el: Element) => {
    for (let a: Element | null = el; a; a = a.parentElement)
      if (/fixed|sticky/.test(getComputedStyle(a).position)) return a;
    return null;
  };
  let collisions = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Text in a pinned layer (tab bar, cart pill, sticky header) passing over scrolling text is
      // an overlay at this scroll position, not two labels laid out on top of each other.
      if (pinned(a.el) !== pinned(b.el)) continue;
      const x =
          Math.min(a.rect.right, b.rect.right) -
          Math.max(a.rect.left, b.rect.left),
        y =
          Math.min(a.rect.bottom, b.rect.bottom) -
          Math.max(a.rect.top, b.rect.top);
      if (x > 2 && y > 2) {
        const cx = Math.max(
            0,
            Math.min(
              innerWidth - 1,
              (Math.max(a.rect.left, b.rect.left) +
                Math.min(a.rect.right, b.rect.right)) /
                2,
            ),
          ),
          cy = Math.max(
            0,
            Math.min(
              innerHeight - 1,
              (Math.max(a.rect.top, b.rect.top) +
                Math.min(a.rect.bottom, b.rect.bottom)) /
                2,
            ),
          );
        const hit = document.elementFromPoint(cx, cy);
        if (hit && (a.el.contains(hit) || b.el.contains(hit))) {
          add(
            truncation,
            a.el,
            `Text intersects ${selector(b.el)} by ${x.toFixed(1)}×${y.toFixed(1)}px`,
          );
          collisions++;
        }
      }
    }
  truncation.value = {
    unallowed: truncation.total,
    allowedEllipses: allowed,
    collisions,
  };
  const shift = (window as typeof window & { __cls?: number }).__cls;
  cls.value = shift ?? null;
  if (shift === undefined || shift > t.cls)
    add(cls, document.body, `Layout shift ${shift ?? "observer unavailable"}`);
  cls.warnings =
    shift !== undefined && shift > t.clsWarning ? ["Above 0.05 target"] : [];
  // Canvas normalizes modern CSS colours (including oklch) into sRGB.
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  canvas.width = canvas.height = 1;
  const rgba = (color: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) =>
      i === 3 ? v / 255 : v,
    );
  };
  const lum = (c: number[]) =>
    c
      .slice(0, 3)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bg = (el: Element | null): number[] => {
    if (!el) return [255, 255, 255, 1];
    const c = rgba(getComputedStyle(el).backgroundColor);
    if (c[3] >= 0.999) return c;
    const parent = bg(el.parentElement);
    return c.map((v, i) => (i === 3 ? 1 : v * c[3] + parent[i] * (1 - c[3])));
  };
  const ratio = (a: number[], b: number[]) => {
    const x = lum(a),
      y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const icons = Array.from(document.querySelectorAll("svg")).filter(
    (el) =>
      visible(el, true) &&
      // Meaningful icons: not hidden from assistive tech (alone or with an aria-hidden wrapper,
      // e.g. a brand logo), unless the icon is all an otherwise empty control shows.
      (!el.closest('[aria-hidden="true"]') ||
        (!!el.closest('button,[role="button"]') &&
          !el.closest('button,[role="button"]')!.textContent?.trim())),
  );
  const boundaries = nodes.filter(
    (el) =>
      el.matches(
        // Fields and toggles whose border is what identifies them (WCAG 1.4.11). Labelled buttons
        // are identified by their text, so their borders are decorative.
        'input:not([type="hidden"],[type="checkbox"],[type="radio"]),textarea,select,[role="combobox"],[role="switch"],[role="checkbox"]',
      ) && parseFloat(getComputedStyle(el).borderTopWidth) > 0,
  );
  for (const el of [...new Set([...boundaries, ...icons])]) {
    if (el.closest(':disabled,[aria-disabled="true"]')) continue;
    const s = getComputedStyle(el),
      back = bg(el.parentElement);
    if (!el.matches("svg") && ratio(bg(el), back) >= t.contrastUI) continue;
    const color = el.matches("svg") ? s.color : s.borderTopColor;
    const c = rgba(color);
    if (c[3] < 0.01) continue;
    const composited = c.map((v, i) =>
      i === 3 ? 1 : v * c[3] + back[i] * (1 - c[3]),
    );
    const r = ratio(composited, back);
    if (r < t.contrastUI)
      add(
        contrast,
        el,
        `UI boundary/icon contrast ${r.toFixed(2)}:1 < ${t.contrastUI}:1`,
      );
  }
  for (const c of [targets, inputs, contrast]) c.value = c.total;
  return [targets, overflow, fonts, inputs, truncation, cls, contrast];
}

async function nodeOffender(
  page: Page,
  selector: string,
  detail: string,
  id: string,
): Promise<{ offender: Offender; exempt: boolean } | null> {
  try {
    return await page
      .locator(selector)
      .first()
      .evaluate(
        (el, { selector, detail, id }) => {
          const r = el.getBoundingClientRect();
          if (
            !r.width ||
            !r.height ||
            (id !== "focus" && (r.bottom <= 0 || r.top >= innerHeight))
          )
            return null;
          let ancestor: Element | null = el;
          let reason = "";
          while (ancestor) {
            const v = ancestor.getAttribute("data-ui-exempt");
            if (v?.startsWith(id + ":")) {
              reason = v;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          return {
            offender: {
              selector,
              // Icon-only controls report their accessible name instead of empty text.
              text: (
                el.textContent?.trim() ||
                el.getAttribute("aria-label") ||
                el.getAttribute("title") ||
                ""
              ).slice(0, 160),
              rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              detail: detail + (reason ? `; ${reason}` : ""),
            },
            exempt: !!reason,
          };
        },
        { selector, detail, id },
      );
  } catch {
    return null;
  }
}
function append(
  check: Check,
  item: { offender: Offender; exempt: boolean } | null,
) {
  if (!item) return;
  if (item.exempt) check.exempted.push(item.offender);
  else {
    check.total++;
    check.pass = false;
    if (check.offenders.length < THRESHOLDS.offenderLimit)
      check.offenders.push(item.offender);
  }
}

/** Samples the actual composited background behind text axe could not resolve. */
async function contrastFallback(
  page: Page,
  selector: string,
): Promise<string | null> {
  const locator = page.locator(selector).first();
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) return null;
  const x = Math.max(0, box.x),
    y = Math.max(0, box.y),
    width = Math.min(vp.width, box.x + box.width) - x,
    height = Math.min(vp.height, box.y + box.height) - y;
  if (width < 1 || height < 1) return null;
  // Behind an open modal (Radix hides the rest of the page with aria-hidden): not readable
  // content in this state; its default state is measured on its own.
  if (
    await locator.evaluate((el) => !!el.closest('[aria-hidden="true"],[inert]'))
  )
    return null;
  const info = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      color: s.color,
      font: parseFloat(s.fontSize),
      bold: parseFloat(s.fontWeight) >= 700,
    };
  });
  // Two shots of the same box, with and without the text: the pixels that differ are the
  // glyphs, and the bare shot gives the background exactly under them. Sampling the whole box
  // would mix in rounded-pill corners and neighbouring elements.
  const clip = { x, y, width, height };
  const withText = await page.screenshot({ clip, scale: "css" });
  let bare: Buffer;
  await locator.evaluate((el) =>
    el.setAttribute("data-ui-loop-contrast", "true"),
  );
  const mask = await page.addStyleTag({
    content:
      "[data-ui-loop-contrast],[data-ui-loop-contrast] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;transition:none!important}",
  });
  try {
    bare = await page.screenshot({ clip, scale: "css" });
  } finally {
    await mask.evaluate((el) => el.parentNode?.removeChild(el));
    await locator.evaluate((el) => el.removeAttribute("data-ui-loop-contrast"));
  }
  return page.evaluate(
    async ({ shots, info, t }) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(
          await (await fetch("data:image/png;base64," + base64)).blob(),
        );
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [text, bg] = await Promise.all(shots.map(decode));
      const linear = (v: number) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r: number, g: number, b: number) =>
        0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      const c = document.createElement("canvas").getContext("2d")!;
      c.fillStyle = info.color;
      c.fillRect(0, 0, 1, 1);
      const fg = c.getImageData(0, 0, 1, 1).data,
        alpha = fg[3] / 255;
      const ratios: number[] = [];
      for (let i = 0; i < bg.length; i += 4) {
        const diff = Math.max(
          Math.abs(text[i] - bg[i]),
          Math.abs(text[i + 1] - bg[i + 1]),
          Math.abs(text[i + 2] - bg[i + 2]),
        );
        if (diff < 24) continue;
        const b = lum(bg[i], bg[i + 1], bg[i + 2]);
        const f = lum(
          fg[0] * alpha + bg[i] * (1 - alpha),
          fg[1] * alpha + bg[i + 1] * (1 - alpha),
          fg[2] * alpha + bg[i + 2] * (1 - alpha),
        );
        ratios.push((Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05));
      }
      if (!ratios.length) return null;
      ratios.sort((a, b) => a - b);
      // Worst case behind the glyphs, ignoring the faintest 5% (anti-aliasing at glyph edges).
      const ratio = ratios[Math.floor(ratios.length * 0.05)],
        required =
          info.font >= 24 || (info.font >= 18.66 && info.bold)
            ? t.contrastLarge
            : t.contrastText;
      return ratio < required
        ? `Screenshot background contrast behind the text ${ratio.toFixed(2)}:1 < ${required}:1`
        : null;
    },
    {
      shots: [withText.toString("base64"), bare.toString("base64")],
      info,
      t: THRESHOLDS,
    },
  );
}
async function focusCheck(page: Page): Promise<Check> {
  const check: Check = {
    id: "focus",
    pass: true,
    value: 0,
    total: 0,
    offenders: [],
    exempted: [],
  };
  // Read finished focus styles, not a ring halfway through its transition.
  const still = await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>(
      "a[href],button,input,select,textarea,[tabindex]",
    )) {
      const s = getComputedStyle(el);
      el.dataset.uiLoopFocus = JSON.stringify({
        outline: s.outline,
        shadow: s.boxShadow,
        // Autofocused (e.g. a dialog's first field): its snapshot already shows the focus style.
        focused: el === document.activeElement,
      });
    }
  });
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const item = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el),
        base = JSON.parse(el.dataset.uiLoopFocus ?? "{}") as {
          outline?: string;
          shadow?: string;
          focused?: boolean;
        };
      const width = parseFloat(s.outlineWidth);
      // A ring is a box-shadow layer with a visible colour and a ≥2px spread. Tailwind's ring
      // stacks transparent placeholder layers first, so every layer is read, not the first.
      const ringLayers = (shadow: string) =>
        shadow === "none"
          ? []
          : shadow.split(/,(?![^(]*\))/).filter((layer) => {
              const color =
                layer.match(
                  /(?:rgba?|oklch|oklab|lab|lch|color|hsla?)\([^)]*\)/,
                )?.[0] ?? "";
              const lengths =
                layer.replace(color, "").match(/-?[\d.]+px/g) ?? [];
              const transparent = /(?:,\s*0\)|\/\s*0\))$/.test(color);
              return (
                !!color && !transparent && parseFloat(lengths[3] ?? "0") >= 2
              );
            });
      const changed =
        ((base.focused || s.outline !== base.outline) &&
          s.outlineStyle !== "none" &&
          width >= 2) ||
        ((base.focused || s.boxShadow !== base.shadow) &&
          ringLayers(s.boxShadow).length > 0);
      const r = el.getBoundingClientRect();
      const visible =
        r.top >= 0 &&
        r.bottom <= innerHeight &&
        r.left >= 0 &&
        r.right <= innerWidth;
      return {
        selector: el.id
          ? "#" + CSS.escape(el.id)
          : el.tagName.toLowerCase() + `[data-ui-loop-active="true"]`,
        changed,
        visible,
      };
    });
    if (!item) break;
    await page.evaluate(() =>
      document.activeElement?.setAttribute("data-ui-loop-active", "true"),
    );
    if (!item.changed || !item.visible)
      append(
        check,
        await nodeOffender(
          page,
          item.selector,
          "Focus indicator lacks a visible ≥2px change or is obscured",
          "focus",
        ),
      );
    // Check the computed indicator colour against the adjacent opaque surface.
    else {
      const detail = await page.locator(item.selector).evaluate((el) => {
        const s = getComputedStyle(el);
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const ctx = c.getContext("2d")!;
        const rgb = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        const lum = (v: number[]) =>
          v
            .slice(0, 3)
            .map((x) => x / 255)
            .map((x) =>
              x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
            )
            .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
        // The outline, or else the most visible ring layer (see ringLayers above).
        const ringColors =
          s.boxShadow === "none"
            ? []
            : s.boxShadow
                .split(/,(?![^(]*\))/)
                .filter(
                  (layer) =>
                    parseFloat(
                      (layer.replace(/\([^)]*\)/, "").match(/-?[\d.]+px/g) ??
                        [])[3] ?? "0",
                    ) >= 2,
                )
                .map(
                  (layer) =>
                    layer.match(
                      /(?:rgba?|oklch|oklab|lab|lch|color|hsla?)\([^)]*\)/,
                    )?.[0] ?? "transparent",
                );
        const candidates =
          parseFloat(s.outlineWidth) >= 2 && s.outlineStyle !== "none"
            ? [s.outlineColor]
            : ringColors;
        let ancestor = el.parentElement;
        let bg = [255, 255, 255, 255];
        while (ancestor) {
          const color = rgb(getComputedStyle(ancestor).backgroundColor);
          if (color[3] > 250) {
            bg = color;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        const b = lum(bg);
        return Math.max(
          1,
          ...candidates.map((color) => {
            const fg = rgb(color);
            const a = fg[3] / 255,
              f = lum(
                fg.map((v, i) => (i < 3 ? v * a + bg[i] * (1 - a) : 255)),
              );
            return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
          }),
        );
      });
      if (detail < 3)
        append(
          check,
          await nodeOffender(
            page,
            item.selector,
            `Focus indicator contrast ${detail.toFixed(2)}:1 < 3:1`,
            "focus",
          ),
        );
    }
    await page.evaluate(() =>
      document
        .querySelectorAll("[data-ui-loop-active]")
        .forEach((el) => el.removeAttribute("data-ui-loop-active")),
    );
  }
  await still.evaluate((tag) => (tag as Element).remove());
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    document
      .querySelectorAll("[data-ui-loop-focus]")
      .forEach((el) => el.removeAttribute("data-ui-loop-focus"));
  });
  check.value = check.total;
  return check;
}
export async function checks(page: Page, device: Device): Promise<Check[]> {
  const results = await page.evaluate(measureDOM, {
    touch: device.hasTouch,
    phone: device.id === "phone",
    t: THRESHOLDS,
  });
  const axe: Check = {
    id: "axe",
    pass: true,
    value: 0,
    total: 0,
    offenders: [],
    exempted: [],
  };
  const contrast = results.find((c) => c.id === "contrast")!;
  const analysis = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  for (const rule of analysis.violations)
    for (const node of rule.nodes) {
      const selector = node.target
        .filter((x) => typeof x === "string")
        .join(" ");
      if (rule.impact === "serious" || rule.impact === "critical")
        append(
          axe,
          await nodeOffender(
            page,
            selector,
            `${rule.id}: ${node.failureSummary ?? rule.help}`,
            "axe",
          ),
        );
      if (rule.id === "color-contrast")
        append(
          contrast,
          await nodeOffender(
            page,
            selector,
            node.failureSummary ?? rule.help,
            "contrast",
          ),
        );
    }
  axe.warnings = analysis.violations
    .filter((r) => !["serious", "critical"].includes(r.impact ?? ""))
    .map((r) => ({ id: r.id, impact: r.impact, count: r.nodes.length }));
  for (const rule of analysis.incomplete.filter(
    (r) => r.id === "color-contrast",
  ))
    for (const node of rule.nodes) {
      const selector = node.target
        .filter((x) => typeof x === "string")
        .join(" ");
      try {
        const detail = await contrastFallback(page, selector);
        if (detail)
          append(
            contrast,
            await nodeOffender(page, selector, detail, "contrast"),
          );
      } catch (e) {
        append(
          contrast,
          await nodeOffender(
            page,
            selector,
            `Contrast fallback could not measure: ${e instanceof Error ? e.message : "unknown error"}`,
            "contrast",
          ),
        );
      }
    }
  axe.value = axe.total;
  contrast.value = contrast.total;
  const scroll = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => e.scrollHeight > e.clientHeight + 1)
      .map((e) => ({ el: e, x: e.scrollLeft, y: e.scrollTop }))
      .map(({ el, x, y }, i) => {
        el.setAttribute("data-ui-loop-scroll", String(i));
        return { i, x, y };
      }),
  );
  const focus =
    device.id === "desktop"
      ? await focusCheck(page)
      : {
          id: "focus",
          pass: true,
          value: "not applicable",
          total: 0,
          offenders: [],
          exempted: [],
        };
  await page.evaluate((scroll) => {
    for (const { i, x, y } of scroll) {
      const el = document.querySelector(`[data-ui-loop-scroll="${i}"]`);
      el?.scrollTo(x, y);
      el?.removeAttribute("data-ui-loop-scroll");
    }
  }, scroll);
  return [axe, ...results, focus];
}
