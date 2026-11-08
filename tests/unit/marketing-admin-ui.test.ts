// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "convex/_generated/dataModel";
import { evaluateOffer, type QuoteLine } from "convex/lib/offers";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CampaignsView } from "@/components/admin/marketing/CampaignsView";
import { LinksView } from "@/components/admin/marketing/LinksView";
import { EMPTY_COUPON_FORM, couponFormErrors, couponFormFrom, couponFormKey, couponRulesFrom, type CouponForm } from "@/components/admin/marketing/coupon-form";
import { countLabel, directOfferApplied, marketingErrorText, qrDirectPercent } from "@/components/admin/marketing/marketing-format";
import type { CampaignRow } from "@/components/admin/marketing/types";

const form = (patch: Partial<CouponForm>): CouponForm => ({ ...EMPTY_COUPON_FORM, code: "SPA-10", value: "10", ...patch });

describe("coupon editor dirty check", () => {
  it("ignores formatting, villa order and surrounding spaces", () => {
    const saved = form({ maxSaving: "3,000", allVillas: false, villas: ["alpha", "beta"], terms: "Book direct" });
    const typed = form({ maxSaving: "3000", allVillas: false, villas: ["beta", "alpha"], terms: "Book direct ", code: "spa-10" });
    expect(couponFormKey(typed)).toBe(couponFormKey(saved));
  });

  it("matches the form rebuilt from what was just saved", () => {
    const typed = form({ maxSaving: "3000", budget: "80000", allVillas: false, villas: ["beta", "alpha"], terms: " Stay 2 nights " });
    const rebuilt = couponFormFrom({ code: "SPA-10", rules: couponRulesFrom(typed) });
    expect(rebuilt.maxSaving).toBe("3,000");
    expect(rebuilt.villas).toEqual(["alpha", "beta"]);
    expect(couponFormKey(rebuilt)).toBe(couponFormKey(typed));
  });

  it("still counts real edits and unparsable text", () => {
    const base = form({});
    expect(couponFormKey(form({ value: "15" }))).not.toBe(couponFormKey(base));
    expect(couponFormKey(form({ campaignId: "c1" }))).not.toBe(couponFormKey(base));
    expect(couponFormKey(form({ budget: "abc" }))).not.toBe(couponFormKey(base));
  });
});

describe("coupon form validation", () => {
  it("needs at least 3 characters, like saveCoupon", () => {
    expect(couponFormErrors(form({ code: "AB" }), { takenCodes: [] }).code).toBe("Use at least 3 characters");
    expect(couponFormErrors(form({ code: "ABC" }), { takenCodes: [] }).code).toBeUndefined();
    expect(couponFormErrors(form({ code: "A".repeat(33) }), { takenCodes: [] }).code).toBe("Keep it to 32 characters");
  });

  it("rejects 0 in the optional limits instead of letting the backend refuse it", () => {
    const errors = couponFormErrors(form({ maxSaving: "0", minNights: "0", minSubtotal: "0", usageLimit: "0", budget: "0" }), { takenCodes: [] });
    expect(errors).toMatchObject({
      maxSaving: "Leave empty for no limit",
      minNights: "Leave empty for no minimum",
      minSubtotal: "Leave empty for no minimum",
      usageLimit: "Leave empty for no limit",
      budget: "Leave empty for no limit",
    });
  });

  it("accepts positive whole numbers only", () => {
    expect(couponFormErrors(form({ budget: "1,500" }), { takenCodes: [] }).budget).toBeUndefined();
    expect(couponFormErrors(form({ budget: "12.5" }), { takenCodes: [] }).budget).toBe("Use a whole number");
    expect(couponFormErrors(form({ budget: "99999999999999999999" }), { takenCodes: [] }).budget).toBe("Use a whole number");
  });
});

describe("test quote direct-offer row", () => {
  const stay: QuoteLine = { id: "accommodation", kind: "accommodation", propertySlug: "a", checkIn: "2026-12-01", checkOut: "2026-12-03", nights: 2, amount: 9000 };
  const spa: QuoteLine = { id: "service-0", kind: "service", label: "Massage", amount: 2000 };
  const coupon = (scope: "services" | "accommodation", percent: number) =>
    ({ code: "X", version: 1, status: "active", benefit: { kind: "percent", percent }, scope, used: 0, discountGranted: 0 }) as const;

  it("is applied when a services coupon stacks on it", () => {
    const result = evaluateOffer({ lines: [stay, spa], directDiscountPercent: 15, today: "2026-11-08", coupon: coupon("services", 20) });
    expect(result.applied).toBe("coupon");
    expect(directOfferApplied(result)).toBe(true);
  });

  it("is not applied when an accommodation coupon replaces it", () => {
    const result = evaluateOffer({ lines: [stay], directDiscountPercent: 15, today: "2026-11-08", coupon: coupon("accommodation", 20) });
    expect(directOfferApplied(result)).toBe(false);
  });

  it("is applied when it wins on its own", () => {
    const result = evaluateOffer({ lines: [stay], directDiscountPercent: 15, today: "2026-11-08", coupon: coupon("accommodation", 10) });
    expect(directOfferApplied(result)).toBe(true);
  });
});

describe("marketingErrorText", () => {
  it("shows the ConvexError message", () => {
    expect(marketingErrorText(new ConvexError({ code: "villa_not_public", message: "Publish the villa first" }), "fallback")).toBe("Publish the villa first");
  });

  it("falls back to the dev message, then the fallback", () => {
    expect(marketingErrorText(new Error("[CONVEX M(marketing:saveLink)] Uncaught Error: Slug taken\n  at handler"), "fallback")).toBe("Slug taken");
    expect(marketingErrorText("nope", "fallback")).toBe("fallback");
  });
});

describe("qrDirectPercent", () => {
  const villas = [
    { slug: "a", status: "active", directDiscountPercent: 10 },
    { slug: "b", status: "active", directDiscountPercent: 20 },
    { slug: "c", status: "draft", directDiscountPercent: 5 },
  ] as const;

  it("uses the destination villa's own percent", () => {
    expect(qrDirectPercent({ kind: "villa", propertySlug: "a" }, villas)).toBe(10);
    expect(qrDirectPercent({ kind: "booking", propertySlug: "b" }, villas)).toBe(20);
  });

  it("promises only what every public villa gives elsewhere", () => {
    expect(qrDirectPercent({ kind: "home" }, villas)).toBe(10);
    expect(qrDirectPercent({ kind: "booking" }, villas)).toBe(10);
  });

  it("promises nothing for a villa guests can't book", () => {
    expect(qrDirectPercent({ kind: "villa", propertySlug: "c" }, villas)).toBe(0);
    expect(qrDirectPercent({ kind: "home" }, [])).toBe(0);
  });
});

describe("countLabel", () => {
  it("marks capped counts as lower bounds", () => {
    expect(countLabel(500, true)).toBe("500+");
    expect(countLabel(1234)).toBe("1,234");
  });
});

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));

const campaign = {
  _id: "c1" as Id<"marketingCampaigns">,
  _creationTime: 0,
  name: "November escape",
  source: "facebook",
  medium: "social",
  status: "draft",
  createdAt: 0,
  updatedAt: 0,
  updatedByEmail: "a@example.com",
  linkCount: 0,
  couponCount: 0,
  opens: 0,
  countsCapped: false,
} as CampaignRow;

let root: Root;
const render = (node: ReactNode) => act(async () => root.render(createElement(ConfirmProvider, null, node)));
const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const escape = () => act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const input = (placeholder: string) => document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
const type = (el: HTMLInputElement | null, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
const NAME = "e.g. Facebook · December getaway";

const actions = () => ({ saveCampaign: vi.fn().mockResolvedValue("c2"), setCampaignStatus: vi.fn().mockResolvedValue(null) });
const campaigns = (a: ReturnType<typeof actions>) =>
  createElement(CampaignsView, { campaigns: [campaign], links: [], coupons: [], today: "2026-11-08", linksHref: "/l", couponHref: (id) => `/c/${id}`, actions: a });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("marketing editor sheets", () => {
  it("asks before discarding unsaved edits, and keeps them on Keep editing", async () => {
    await render(campaigns(actions()));
    await click(button("New campaign"));
    expect(input(NAME)).not.toBeNull();
    await type(input(NAME), "Spa week");

    await click(button("Cancel"));
    expect(document.body.textContent).toContain("Discard your changes?");
    await click(button("Keep editing"));
    expect(input(NAME)?.value).toBe("Spa week");

    await escape();
    await click(button("Discard"));
    expect(input(NAME)).toBeNull();
  });

  it("closes an untouched editor without asking", async () => {
    await render(campaigns(actions()));
    await click(button("New campaign"));
    await click(button("Cancel"));
    expect(document.body.textContent).not.toContain("Discard your changes?");
    expect(input(NAME)).toBeNull();
  });

  it("saves with the trimmed args, closes and reports it", async () => {
    const a = actions();
    await render(campaigns(a));
    await click(button("New campaign"));
    await type(input(NAME), " Spa week ");
    const [source, medium] = document.querySelectorAll<HTMLInputElement>("input[list]");
    await type(source, "Facebook");
    await type(medium, "Social");
    await click(button("Create campaign"));
    expect(a.saveCampaign).toHaveBeenCalledWith({ campaignId: undefined, name: "Spa week", source: "facebook", medium: "social", startsOn: undefined, endsOn: undefined, budget: undefined, notes: undefined });
    expect(input(NAME)).toBeNull();
    expect(document.body.textContent).toContain("Created Spa week as a draft");
  });

  it("shows a failed save's ConvexError message and keeps the form open", async () => {
    const a = actions();
    a.saveCampaign.mockRejectedValue(new ConvexError({ code: "invalid", message: "Name is taken" }));
    await render(campaigns(a));
    await click(button("New campaign"));
    await type(input(NAME), "Spa week");
    const [source, medium] = document.querySelectorAll<HTMLInputElement>("input[list]");
    await type(source, "facebook");
    await type(medium, "social");
    await click(button("Create campaign"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Name is taken");
    expect(input(NAME)?.value).toBe("Spa week");
  });

  it("confirms a status change, runs it and reports it", async () => {
    const a = actions();
    await render(campaigns(a));
    await click([...document.querySelectorAll("button")].find((el) => el.textContent === "November escape"));
    await click(button("Start"));
    expect(document.body.textContent).toContain("Start “November escape”?");
    await click(button("Confirm"));
    expect(a.setCampaignStatus).toHaveBeenCalledWith({ campaignId: "c1", status: "active" });
    expect(document.body.textContent).toContain("November escape is active");
  });

  it("opens a link quick start from the first run, prefilled", async () => {
    await render(
      createElement(LinksView, {
        links: [],
        campaigns: [campaign],
        coupons: [],
        properties: [],
        origin: "https://book.example",
        brand: "Auralis",
        today: "2026-11-08",
        campaignsHref: "/c",
        actions: { saveLink: vi.fn(), setLinkStatus: vi.fn(), checkSlug: vi.fn().mockResolvedValue({ ok: true, slug: "f" }) },
      }),
    );
    await click([...document.querySelectorAll("button")].find((el) => el.textContent?.includes("Facebook page")));
    expect(document.body.textContent).toContain("New link");
    expect(input("e.g. Facebook · November post")?.value).toBe("Facebook page");
    await click(button("Cancel"));
    expect(document.body.textContent).not.toContain("Discard your changes?");
    expect(input("e.g. Facebook · November post")).toBeNull();
  });
});
