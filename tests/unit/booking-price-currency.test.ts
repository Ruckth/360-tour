import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BookingProperty } from "@/lib/booking/booking";

const comparison = vi.hoisted(() => ({ currency: "THB" }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: { amount?: string }) => (values?.amount ? `${key} ${values.amount}` : key),
}));
// Only the data hook is stubbed; the real OtaRateComparison renders inside the summary.
vi.mock("@/components/pricing/OtaRateComparison", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/pricing/OtaRateComparison")>()),
  useOtaComparison: () => ({
    currency: comparison.currency, pricePerNight: 100, directDiscountPercent: 10,
    rates: [{ platform: "airbnb", nightlyRate: 130, updatedAt: 1_800_000_000_000 }],
  }),
}));
vi.mock("@/components/property/PropertyImage", () => ({ PropertyImage: () => null }));

const { BookingPriceSummary } = await import("@/components/booking/BookingPriceSummary");
const { VillaSelector } = await import("@/components/booking/VillaSelector");

function render(currency: string) {
  comparison.currency = currency;
  const property = { slug: "villa", name: "Villa", tagline: "", images: [], pricePerNight: 100, currency, directDiscountPercent: 10 };
  return renderToStaticMarkup(createElement(BookingPriceSummary, {
    property: property as unknown as BookingProperty, nights: 2, subtotal: 200, discount: 20, total: 180,
  })).replace(/<!-- -->/g, "");
}

describe("booking price summary currency", () => {
  it("labels every USD amount, including the embedded OTA comparison, in USD", () => {
    const html = render("USD");
    expect(html).not.toContain("฿");
    // Rate, subtotal, discount and total.
    for (const amount of ["USD 100", "USD 200", "-USD 20", "USD 180"]) expect(html).toContain(amount);
    // Comparison: direct 2 nights at 10% off, Airbnb 2 x 130, and the saving.
    for (const amount of ["USD 180", "USD 260", "save USD 80", "youSave USD 80"]) expect(html).toContain(amount);
  });

  it("keeps the baht symbol for THB villas", () => {
    const html = render("THB");
    expect(html).not.toContain("THB ");
    for (const amount of ["฿100", "฿200", "-฿20", "฿180", "฿260", "save ฿80"]) expect(html).toContain(amount);
  });
});

describe("villa selector currency", () => {
  it("prices each villa card in its own currency", () => {
    const villa = (slug: string, currency: string) => ({ _id: slug, slug, name: slug, images: [], pricePerNight: 100, currency, maxGuests: 2 });
    const html = renderToStaticMarkup(createElement(VillaSelector, {
      properties: [villa("usd-villa", "USD"), villa("thb-villa", "THB")] as unknown as BookingProperty[],
      selectedId: "usd-villa", availablePropertyIds: new Set(["usd-villa", "thb-villa"]), onSelect: () => {},
    })).replace(/<!-- -->/g, "");
    expect(html).toContain("USD 100");
    expect(html).toContain("฿100");
  });
});
