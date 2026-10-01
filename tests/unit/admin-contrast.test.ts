import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CALENDAR_TONE_COLORS, TONES, type Tone } from "@/components/admin/status-tones";

// Reads the real token values from src/app.css and Tailwind's palette, so nothing here needs syncing.
const appCss = readFileSync(new URL("../../src/app.css", import.meta.url), "utf8");
const tailwindCss = readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8");

type Linear = [number, number, number];

function parseOklch(value: string): Linear {
  const match = value.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!match) throw new Error(`Not an oklch() colour: ${value}`);
  const L = Number(match[1]) / (match[2] ? 100 : 1);
  const C = Number(match[3]);
  const h = (Number(match[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((x) => Math.min(1, Math.max(0, x))) as Linear;
}

const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Alpha-composite `fg` over `bg` the way browsers do (in gamma-encoded sRGB). */
function over(fg: Linear, bg: Linear, alpha: number): Linear {
  return fg.map((x, i) => decode(encode(x) * alpha + encode(bg[i]) * (1 - alpha))) as Linear;
}

function contrast(a: Linear, b: Linear) {
  const lum = ([r, g, bl]: Linear) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function block(selector: string) {
  const start = appCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector} in app.css`);
  return appCss.slice(start, appCss.indexOf("}", start));
}

function vars(css: string) {
  return Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)].map(([, name, value]) => [name, parseOklch(value)]));
}

const themes = { light: vars(block(":root")), dark: vars(block(".dark")) };
const palette = vars(tailwindCss);
type Theme = keyof typeof themes;

function token(theme: Theme, name: string) {
  const value = themes[theme][name];
  if (!value) throw new Error(`Missing --${name} in ${theme} theme`);
  return value;
}

/** Resolves one tone class for a theme, e.g. "text-blue-700 dark:text-blue-300" → colour + alpha. */
function toneColor(classes: string, prefix: "bg" | "text", theme: Theme) {
  const parts = classes.split(/\s+/);
  const pick =
    (theme === "dark" ? parts.find((c) => c.startsWith(`dark:${prefix}-`)) : undefined) ??
    parts.find((c) => c.startsWith(`${prefix}-`));
  if (!pick) throw new Error(`No ${prefix} colour in "${classes}"`);
  const [name, alpha] = pick.replace(/^dark:/, "").slice(prefix.length + 1).split("/");
  const color = palette[`color-${name}`] ?? themes[theme][name];
  if (!color) throw new Error(`Unknown colour ${name}`);
  return { color, alpha: alpha ? Number(alpha) / 100 : 1 };
}

describe("theme token contrast (WCAG AA)", () => {
  for (const theme of ["light", "dark"] as const) {
    const t = (name: string) => token(theme, name);

    it(`${theme}: text tokens are ≥4.5:1 on background, card and muted`, () => {
      for (const surface of ["background", "card", "muted"]) {
        expect(contrast(t("foreground"), t(surface))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t("muted-foreground"), t(surface))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t("gold-text"), t(surface))).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of ["background", "card"]) {
        expect(contrast(t("destructive"), t(surface))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: filled buttons keep ≥4.5:1 text`, () => {
      expect(contrast(t("primary-foreground"), t("primary"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t("destructive-foreground"), t("destructive"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: focus ring and selected toggle are ≥3:1 against their surface`, () => {
      for (const surface of ["background", "card"]) {
        expect(contrast(t("ring"), t(surface))).toBeGreaterThanOrEqual(3);
        expect(contrast(t("sidebar-ring"), t(surface))).toBeGreaterThanOrEqual(3);
        expect(contrast(t("primary"), t(surface))).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme}: borders are visible but subtle`, () => {
      const ratio = contrast(t("border"), t("card"));
      expect(ratio).toBeGreaterThanOrEqual(1.5);
      expect(ratio).toBeLessThan(2.5);
    });

    it(`${theme}: every status tone has ≥4.5:1 text on its tinted background`, () => {
      for (const [tone, classes] of Object.entries(TONES)) {
        const bg = toneColor(classes.bg, "bg", theme);
        const text = toneColor(classes.text, "text", theme);
        const surface = over(bg.color, t("card"), bg.alpha);
        expect(contrast(over(text.color, surface, text.alpha), surface), tone).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: calendar chips keep foreground text ≥4.5:1 at the selected tint`, () => {
      for (const [tone, value] of Object.entries(CALENDAR_TONE_COLORS) as [Tone, string][]) {
        const name = value.match(/var\(--(color-[\w-]+)\)/)?.[1] ?? "";
        const chip = over(palette[name], t("background"), 0.3);
        expect(contrast(t("foreground"), chip), tone).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
