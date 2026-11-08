import qrcode from "qrcode-generator";

// The QR offer card as a list of drawing items, rendered either to an SVG string (preview and
// SVG download) or to a canvas (PNG download). Layout follows docs/previews/marketing/links-qr.html.

export const QR_CARD_FORMATS = {
  square: { width: 1080, height: 1080, label: "Square post", size: "1080 × 1080 px", use: "Facebook and Instagram posts, LINE chats", file: "square-1080" },
  story: { width: 1080, height: 1920, label: "Story", size: "1080 × 1920 px", use: "Instagram, Facebook and LINE stories", file: "story-1080x1920" },
  a6: { width: 1240, height: 1748, label: "A6 print", size: "105 × 148 mm at 300 dpi", use: "Table cards, flyers and posters", file: "a6-print" },
} as const;
export type QrCardFormat = keyof typeof QR_CARD_FORMATS;

export type QrCardContent = {
  /** Full URL the code opens, e.g. https://book.auralis.example/f1. Tracking is the slug; nothing else is added. */
  url: string;
  /** The URL as printed under the code, without the scheme. */
  displayUrl: string;
  brand: string;
  place: string;
  eyebrow: string;
  head: string;
  sub: string;
  /** Coupon code, printed large. Without one the card says "No code needed". */
  code?: string;
  terms: string;
  expiry: string;
};

const NAVY = "#1d293d";
const GOLD_TEXT = "#92600b";
const GOLD_LIGHT = "#edc793";
const INK = "#3b485e";
const MUTE = "#5d6676";
const PANEL = "#f5efe4";
const TAGLINE = "Screenshot now, book later.";

type Fonts = { sans: string; serif: string };
const DEFAULT_FONTS: Fonts = {
  sans: "Manrope, 'Helvetica Neue', Arial, sans-serif",
  serif: "'Cormorant Garamond', Georgia, serif",
};

type TextItem = {
  t: "text";
  x: number;
  y: number;
  size: number;
  weight?: number;
  serif?: boolean;
  italic?: boolean;
  color: string;
  spacing?: number;
  align?: "start" | "middle" | "end";
  lineHeight?: number;
  lines: string[];
};
type Item =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: number[] }
  | { t: "ring"; cx: number; cy: number; r: number; color: string; clipH: number }
  | { t: "qr"; x: number; y: number; size: number }
  | TextItem;

type QrCardSpec = { width: number; height: number; items: Item[]; matrix: QrMatrix };
type QrMatrix = { count: number; dark: (row: number, col: number) => boolean };

const QUIET_MODULES = 4;

/** Brand panel height, brand text position and size, place-line size. */
const TOP: Record<QrCardFormat, { ph: number; bx: number; by: number; bs: number; vs: number }> = {
  square: { ph: 500, bx: 64, by: 112, bs: 46, vs: 26 },
  story: { ph: 760, bx: 72, by: 132, bs: 62, vs: 32 },
  a6: { ph: 600, bx: 80, by: 134, bs: 66, vs: 34 },
};

/** Positions for the centred (story and print) layouts. */
const CENTERED = {
  story: { ey: 852, es: 30, hy: 1012, hs: 184, sy: 1080, ss: 42, cbx: 190, cby: 1118, cbw: 700, cbh: 120, cs: 60, qs: 420, qy: 1268, uy: 1742, us: 32, ty: 1792, ts: 25, tlh: 33, band: 1846, bandS: 40 },
  a6: { ey: 694, es: 30, hy: 860, hs: 196, sy: 930, ss: 44, cbx: 270, cby: 966, cbw: 700, cbh: 116, cs: 58, qs: 404, qy: 1108, uy: 1558, us: 34, ty: 1606, ts: 26, tlh: 34, band: 1668, bandS: 40 },
};

function qrMatrix(text: string): QrMatrix {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  return { count: code.getModuleCount(), dark: (row, col) => code.isDark(row, col) };
}

/** Rough text width for wrapping (Manrope averages ~0.55em per character). */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const chunks = text.split(" · ");
  const lines: string[] = [];
  let current = "";
  for (const chunk of chunks) {
    const next = current ? `${current} · ${chunk}` : chunk;
    if (current && next.length * size * 0.55 > maxWidth) {
      lines.push(current);
      current = chunk;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

export function buildQrCard(content: QrCardContent, format: QrCardFormat): QrCardSpec {
  const { width: W, height: H } = QR_CARD_FORMATS[format];
  const items: Item[] = [{ t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff" }];
  const centered = format !== "square";
  const P = TOP[format];
  // Brand panel: navy with soft gold rings.
  items.push({ t: "rect", x: 0, y: 0, w: W, h: P.ph, fill: NAVY });
  [0.22, 0.38, 0.54, 0.7, 0.86].forEach((f, i) =>
    items.push({ t: "ring", cx: W * 0.86, cy: P.ph * 1.02, r: W * f, color: `rgba(237,199,147,${(0.3 - i * 0.05).toFixed(2)})`, clipH: P.ph }),
  );
  items.push({ t: "rect", x: P.bx, y: P.ph - P.vs * 2.6, w: P.bs * 1.6, h: 3, fill: GOLD_LIGHT });
  items.push({ t: "text", x: P.bx, y: P.by, size: P.bs, serif: true, weight: 600, color: GOLD_LIGHT, lines: [content.brand] });
  items.push({ t: "text", x: P.bx, y: P.ph - P.vs * 1.4, size: P.vs, weight: 600, color: "rgba(255,255,255,0.92)", lines: [content.place] });

  if (!centered) {
    items.push({ t: "text", x: 64, y: 584, size: 22, weight: 700, color: GOLD_TEXT, spacing: 3.5, lines: [content.eyebrow.toUpperCase()] });
    items.push({ t: "text", x: 60, y: 700, size: 124, serif: true, weight: 600, color: NAVY, lines: [content.head] });
    items.push({ t: "text", x: 64, y: 752, size: 30, weight: 500, color: INK, lines: [content.sub] });
    items.push({ t: "rect", x: 64, y: 790, w: 540, h: 92, r: 14, fill: "#fbfaf8", stroke: NAVY, sw: 3, dash: [12, 9] });
    if (content.code) {
      items.push({ t: "text", x: 94, y: 846, size: 19, weight: 700, color: MUTE, spacing: 2.5, lines: ["CODE"] });
      items.push({ t: "text", x: 176, y: 852, size: content.code.length > 14 ? 34 : 42, weight: 800, color: NAVY, spacing: 1.5, lines: [content.code] });
    } else items.push({ t: "text", x: 334, y: 848, size: 32, weight: 700, color: NAVY, align: "middle", lines: ["No code needed"] });
    items.push({ t: "text", x: 64, y: 928, size: 20, weight: 500, color: MUTE, lineHeight: 28, lines: wrap(content.terms, 20, 560).slice(0, 2) });
    items.push({ t: "qr", x: 668, y: 548, size: 348 });
    items.push({ t: "text", x: 842, y: 940, size: 22, weight: 700, color: NAVY, align: "middle", lines: [content.displayUrl] });
    items.push({ t: "rect", x: 0, y: 990, w: W, h: 90, fill: NAVY });
    items.push({ t: "text", x: 64, y: 1046, size: 36, serif: true, italic: true, weight: 600, color: GOLD_LIGHT, lines: [TAGLINE] });
    items.push({ t: "text", x: W - 64, y: 1043, size: 20, weight: 600, color: "rgba(255,255,255,0.82)", align: "end", lines: [content.expiry] });
  } else {
    const p = { ...P, ...CENTERED[format as Exclude<QrCardFormat, "square">] };
    const cx = W / 2;
    items.push({ t: "text", x: cx, y: p.ey, size: p.es, weight: 700, color: GOLD_TEXT, spacing: 5, align: "middle", lines: [content.eyebrow.toUpperCase()] });
    items.push({ t: "text", x: cx, y: p.hy, size: p.hs, serif: true, weight: 600, color: NAVY, align: "middle", lines: [content.head] });
    items.push({ t: "text", x: cx, y: p.sy, size: p.ss, weight: 500, color: INK, align: "middle", lines: [content.sub] });
    items.push({ t: "rect", x: p.cbx, y: p.cby, w: p.cbw, h: p.cbh, r: 18, fill: "#fbfaf8", stroke: NAVY, sw: 4, dash: [16, 12] });
    const mid = p.cby + p.cbh / 2;
    if (content.code) {
      const size = content.code.length > 14 ? p.cs * 0.8 : p.cs;
      items.push({ t: "text", x: p.cbx + 36, y: mid + 9, size: 24, weight: 700, color: MUTE, spacing: 3, lines: ["CODE"] });
      items.push({ t: "text", x: cx + 50, y: mid + size * 0.36, size, weight: 800, color: NAVY, spacing: 2, align: "middle", lines: [content.code] });
    } else items.push({ t: "text", x: cx, y: mid + 16, size: 46, weight: 700, color: NAVY, align: "middle", lines: ["No code needed"] });
    items.push({ t: "qr", x: cx - p.qs / 2, y: p.qy, size: p.qs });
    items.push({ t: "text", x: cx, y: p.uy, size: p.us, weight: 700, color: NAVY, align: "middle", lines: [content.displayUrl] });
    items.push({ t: "text", x: cx, y: p.ty, size: p.ts, weight: 500, color: MUTE, align: "middle", lineHeight: p.tlh, lines: wrap(content.terms, p.ts, W - 2 * p.bx - 40).slice(0, 2) });
    items.push({ t: "rect", x: 0, y: p.band, w: W, h: H - p.band, fill: NAVY });
    items.push({ t: "text", x: cx, y: p.band + (H - p.band) / 2 + p.bandS * 0.32, size: p.bandS, serif: true, italic: true, weight: 600, color: GOLD_LIGHT, align: "middle", lines: [TAGLINE] });
  }
  return { width: W, height: H, items, matrix: qrMatrix(content.url) };
}

function qrGeometry(item: Extract<Item, { t: "qr" }>, matrix: QrMatrix) {
  const pad = Math.round(item.size * 0.05);
  const cell = Math.floor((item.size - 2 * pad) / (matrix.count + 2 * QUIET_MODULES));
  const box = cell * (matrix.count + 2 * QUIET_MODULES);
  const bx = Math.round(item.x + (item.size - box) / 2);
  const by = Math.round(item.y + (item.size - box) / 2);
  return { cell, box, bx, by, ox: bx + QUIET_MODULES * cell, oy: by + QUIET_MODULES * cell };
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const anchor = (align?: TextItem["align"]) => align ?? "start";

/** The card as SVG markup. `standalone` adds width/height for a downloadable file. */
export function qrCardSvg(spec: QrCardSpec, { standalone = false, fonts = DEFAULT_FONTS }: { standalone?: boolean; fonts?: Fonts } = {}) {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}"${standalone ? ` width="${spec.width}" height="${spec.height}"` : ""} role="img" aria-label="QR offer card">`,
  ];
  const clipH = spec.items.find((item): item is Extract<Item, { t: "ring" }> => item.t === "ring")?.clipH ?? 0;
  out.push(`<defs><clipPath id="qr-card-top"><rect x="0" y="0" width="${spec.width}" height="${clipH}"/></clipPath></defs>`);
  for (const item of spec.items) {
    if (item.t === "rect") {
      const stroke = item.stroke ? ` stroke="${item.stroke}" stroke-width="${item.sw}"${item.dash ? ` stroke-dasharray="${item.dash.join(" ")}"` : ""}` : "";
      out.push(`<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}"${item.r ? ` rx="${item.r}"` : ""} fill="${item.fill ?? "none"}"${stroke}/>`);
    } else if (item.t === "ring") {
      out.push(`<circle cx="${item.cx}" cy="${item.cy}" r="${item.r}" fill="none" stroke="${item.color}" stroke-width="2" clip-path="url(#qr-card-top)"/>`);
    } else if (item.t === "text") {
      const family = escapeXml(item.serif ? fonts.serif : fonts.sans);
      const attrs = `font-family="${family}" font-size="${item.size}" font-weight="${item.weight ?? 500}" fill="${item.color}" text-anchor="${anchor(item.align)}"${item.spacing ? ` letter-spacing="${item.spacing}"` : ""}${item.italic ? ' font-style="italic"' : ""}`;
      const spans = item.lines.map((line, i) => `<tspan x="${item.x}" y="${item.y + i * (item.lineHeight ?? 0)}">${escapeXml(line)}</tspan>`).join("");
      out.push(`<text ${attrs}>${spans}</text>`);
    } else {
      const g = qrGeometry(item, spec.matrix);
      let d = "";
      for (let r = 0; r < spec.matrix.count; r++)
        for (let c = 0; c < spec.matrix.count; c++)
          if (spec.matrix.dark(r, c)) d += `M${g.ox + c * g.cell} ${g.oy + r * g.cell}h${g.cell}v${g.cell}h-${g.cell}z`;
      out.push(
        `<rect x="${item.x}" y="${item.y}" width="${item.size}" height="${item.size}" rx="${Math.round(item.size * 0.06)}" fill="${PANEL}"/>`,
        `<rect x="${g.bx}" y="${g.by}" width="${g.box}" height="${g.box}" fill="#ffffff"/>`,
        `<path d="${d}" fill="${NAVY}" shape-rendering="crispEdges"/>`,
      );
    }
  }
  out.push("</svg>");
  return out.join("");
}

/** Draws the card on a canvas for the PNG download (browser only). */
export function drawQrCard(spec: QrCardSpec, fonts: Fonts): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can’t draw images.");
  for (const item of spec.items) {
    if (item.t === "rect") {
      ctx.beginPath();
      if (item.r && ctx.roundRect) ctx.roundRect(item.x, item.y, item.w, item.h, item.r);
      else ctx.rect(item.x, item.y, item.w, item.h);
      if (item.fill) {
        ctx.fillStyle = item.fill;
        ctx.fill();
      }
      if (item.stroke) {
        ctx.setLineDash(item.dash ?? []);
        ctx.lineWidth = item.sw ?? 1;
        ctx.strokeStyle = item.stroke;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (item.t === "ring") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, spec.width, item.clipH);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(item.cx, item.cy, item.r, 0, Math.PI * 2);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else if (item.t === "text") {
      ctx.font = `${item.italic ? "italic " : ""}${item.weight ?? 500} ${item.size}px ${item.serif ? fonts.serif : fonts.sans}`;
      ctx.fillStyle = item.color;
      ctx.textAlign = item.align === "middle" ? "center" : item.align === "end" ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${item.spacing ?? 0}px`;
      item.lines.forEach((line, i) => ctx.fillText(line, item.x, item.y + i * (item.lineHeight ?? 0)));
    } else {
      const g = qrGeometry(item, spec.matrix);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(item.x, item.y, item.size, item.size, Math.round(item.size * 0.06));
      else ctx.rect(item.x, item.y, item.size, item.size);
      ctx.fillStyle = PANEL;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(g.bx, g.by, g.box, g.box);
      ctx.fillStyle = NAVY;
      for (let r = 0; r < spec.matrix.count; r++)
        for (let c = 0; c < spec.matrix.count; c++)
          if (spec.matrix.dark(r, c)) ctx.fillRect(g.ox + c * g.cell, g.oy + r * g.cell, g.cell, g.cell);
    }
  }
  return canvas;
}

/** The app's loaded font stacks (next/font hashes the family names), so the PNG matches the preview. */
export function documentFonts(): Fonts {
  if (typeof document === "undefined") return DEFAULT_FONTS;
  const probe = document.createElement("span");
  probe.className = "font-serif";
  probe.hidden = true;
  document.body.append(probe);
  const serif = getComputedStyle(probe).fontFamily;
  probe.remove();
  const sans = getComputedStyle(document.body).fontFamily;
  return { sans: sans || DEFAULT_FONTS.sans, serif: serif || DEFAULT_FONTS.serif };
}
