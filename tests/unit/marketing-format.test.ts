import { describe, expect, it } from "vitest";
import type { OfferResult } from "convex/lib/offers";
import {
  benefitLabel,
  couponRulesLine,
  couponState,
  formatRange,
  generatedTerms,
  normalizeSlugInput,
  quoteVerdict,
  scopeLabel,
  shortUrl,
  slugCheckMessage,
} from "@/components/admin/marketing/marketing-format";
import { bangkokToday, nightsBetween } from "@/components/admin/marketing/format-basics";
import { buildQrCard, qrCardSvg } from "@/components/admin/marketing/qr-card";
import type { CouponRow } from "@/components/admin/marketing/types";

const F1 = {
  benefit: { kind: "percent", percent: 20 },
  scope: "accommodation",
  bookFrom: "2026-11-01",
  bookTo: "2026-11-30",
  stayFrom: "2026-11-01",
  stayTo: "2026-12-20",
  minNights: 2,
  maxSaving: 3000,
  usageLimit: 500,
  discountBudget: 80000,
} as const;

const quote = (overrides: Partial<OfferResult>): OfferResult => ({
  subtotal: 9000,
  applied: "none",
  couponStatus: "none",
  directDiscount: 0,
  couponDiscount: 0,
  capped: false,
  discount: 0,
  total: 9000,
  allocation: [],
  ...overrides,
});

describe("marketing labels", () => {
  it("formats date ranges like the sample data", () => {
    expect(formatRange("2026-11-01", "2026-11-30")).toBe("1–30 Nov 2026");
    expect(formatRange("2026-11-01", "2026-12-20")).toBe("1 Nov–20 Dec 2026");
    expect(formatRange("2025-12-20", "2026-01-05")).toBe("20 Dec 2025–5 Jan 2026");
    expect(formatRange("2026-11-15")).toBe("from 15 Nov 2026");
    expect(formatRange(undefined, "2026-11-30")).toBe("until 30 Nov 2026");
    expect(formatRange()).toBe("Ongoing");
  });

  it("summarises benefit, scope and rules", () => {
    expect(benefitLabel({ kind: "percent", percent: 20 })).toBe("20% off");
    expect(benefitLabel({ kind: "fixed", amount: 500 })).toBe("฿500 off");
    const name = (slug: string) => ({ "mossbell-garden-suite": "Mossbell Garden Suite" })[slug] ?? slug;
    expect(scopeLabel("accommodation", undefined, name)).toBe("Accommodation, all villas");
    expect(scopeLabel("accommodation", ["mossbell-garden-suite"], name)).toBe("Accommodation, Mossbell Garden Suite");
    expect(scopeLabel("services", undefined, name)).toBe("Spa services");
    expect(couponRulesLine(F1)).toBe("Book 1–30 Nov 2026 · stay 1 Nov–20 Dec 2026 · min 2 nights · max saving ฿3,000");
    expect(couponRulesLine({ benefit: { kind: "percent", percent: 10 } })).toBe("Ongoing, no minimum");
    expect(generatedTerms(F1)).toBe(
      "Book by 30 Nov 2026 · Stay 1 Nov–20 Dec 2026 · Min 2 nights · Max saving ฿3,000 · While codes last · One code per booking",
    );
  });

  it("derives what a live coupon does today", () => {
    const row = (over: Partial<CouponRow>) =>
      ({ status: "active", used: 38, discountGranted: 66450, rules: { ...F1 }, ...over }) as unknown as CouponRow;
    expect(couponState(row({}), "2026-11-07")).toBe("active");
    expect(couponState(row({}), "2026-12-01")).toBe("expired");
    expect(couponState(row({}), "2026-10-20")).toBe("scheduled");
    expect(couponState(row({ used: 500 }), "2026-11-07")).toBe("sold_out");
    expect(couponState(row({ discountGranted: 80000 }), "2026-11-07")).toBe("budget_used");
    expect(couponState(row({ status: "paused" }), "2026-11-07")).toBe("paused");
  });

  it("builds short links and slug messages", () => {
    expect(shortUrl("https://book.auralis.example/", "/f1")).toEqual({ full: "https://book.auralis.example/f1", display: "book.auralis.example/f1" });
    expect(normalizeSlugInput(" /Spa Week")).toBe("spa-week");
    expect(normalizeSlugInput("/Spa Week")).toBe("spa-week");
    expect(slugCheckMessage({ ok: true, slug: "f2" })).toBeNull();
    expect(slugCheckMessage({ ok: false, slug: "f1", reason: "taken" }, "Facebook · November post")).toBe("Already used by Facebook · November post");
    expect(slugCheckMessage({ ok: false, slug: "rooms", reason: "reserved" })).toBe("Reserved by the site");
    expect(slugCheckMessage({ ok: false, slug: "F_1", reason: "invalid" })).toBe("Use lower-case letters, numbers and dashes");
  });

  it("counts nights and today's date in Bangkok", () => {
    expect(nightsBetween("2026-11-12", "2026-11-14")).toBe(2);
    expect(nightsBetween("2026-11-14", "2026-11-12")).toBe(0);
    // 7 Nov 2026 18:00 UTC is already 8 Nov in Bangkok.
    expect(bangkokToday(Date.UTC(2026, 10, 7, 18))).toBe("2026-11-08");
  });
});

describe("test-quote verdict", () => {
  it("says the coupon wins and by how much (Mossbell 2 nights)", () => {
    const verdict = quoteVerdict(quote({ applied: "coupon", couponStatus: "applied", directDiscount: 1350, couponDiscount: 1800, discount: 1800, total: 7200 }));
    expect(verdict).toEqual({ tone: "success", title: "Coupon wins", detail: "It saves ฿450 more than the direct offer, so it replaces it." });
  });

  it("says the direct offer wins over a capped coupon (Canopy 3 nights)", () => {
    const verdict = quoteVerdict(
      quote({ subtotal: 36000, applied: "direct", couponStatus: "coupon_worse", directDiscount: 5400, couponDiscount: 3000, capped: true, discount: 5400, total: 30600 }),
    );
    expect(verdict.title).toBe("Direct offer wins");
    expect(verdict.detail).toBe("฿5,400 direct vs ฿3,000 with the code (capped). The code isn’t used.");
  });

  it("explains a failed rule and what the guest keeps (Tideglass 1 night)", () => {
    const verdict = quoteVerdict(
      quote({
        subtotal: 8500,
        applied: "direct",
        couponStatus: "invalid",
        problem: { code: "min_nights", minNights: 2, missingNights: 1 },
        directDiscount: 1275,
        discount: 1275,
        total: 7225,
      }),
    );
    expect(verdict).toEqual({
      tone: "warning",
      title: "Minimum nights",
      detail: "Add 1 more night to use this offer. The guest keeps the direct offer: ฿7,225.",
    });
  });
});

describe("QR offer card", () => {
  it("encodes the full short link and prints the code and terms", () => {
    const content = {
      url: "https://book.auralis.example/f1",
      displayUrl: "book.auralis.example/f1",
      brand: "Auralis Cove Retreat",
      place: "Koh Samui, Thailand",
      eyebrow: "Direct booking offer",
      head: "Save 20%",
      sub: "on villa stays booked direct",
      code: "DCNT-F1-20",
      terms: "Book by 30 Nov 2026 · Min 2 nights",
      expiry: "Book by 30 Nov 2026",
    };
    for (const format of ["square", "story", "a6"] as const) {
      const spec = buildQrCard(content, format);
      const svg = qrCardSvg(spec, { standalone: true });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain(">DCNT-F1-20<");
      expect(svg).toContain(">book.auralis.example/f1<");
      expect(svg).toContain("Min 2 nights");
      expect(spec.matrix.count).toBeGreaterThanOrEqual(21);
    }
  });

  it("escapes names it prints", () => {
    const spec = buildQrCard(
      { url: "https://x.example/a", displayUrl: "x.example/a", brand: "Ben & <Co>", place: "", eyebrow: "", head: "", sub: "", terms: "", expiry: "" },
      "square",
    );
    expect(qrCardSvg(spec)).toContain("Ben &amp; &lt;Co&gt;");
  });
});
