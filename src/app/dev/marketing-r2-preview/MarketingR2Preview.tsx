"use client";

// TEMPORARY — DELETE BEFORE MERGE. Sample-data harness for the R2a coupon screens (kit/data.md).

import { evaluateOffer, type CouponRules, type OfferResult } from "convex/lib/offers";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BookedPrice } from "@/components/booking/BookedPrice";
import { BookingPriceSummary, PriceLines } from "@/components/booking/BookingPriceSummary";
import { ReviewPanel } from "@/components/booking/BookingPanels";
import { CouponField, type CouponNotice } from "@/components/booking/CouponField";
import { useCouponCopy } from "@/components/booking/coupon-copy";
import { CouponLedger } from "@/components/admin/marketing/CouponLedger";
import { QuoteVerdictBox } from "@/components/admin/marketing/TestQuotePanel";
import { usageWithHeld } from "@/components/admin/marketing/marketing-format";
import type { RedemptionRow } from "@/components/admin/marketing/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { couponPhase, stayPrice, summaryNote, type CouponPhase } from "@/lib/booking/coupon";
import type { BookingProperty } from "@/lib/booking/booking";
import { properties } from "@/lib/data/properties";
import { cn } from "@/lib/utils";

const F1: CouponRules = {
  code: "DCNT-F1-20", version: 1, status: "active", benefit: { kind: "percent", percent: 20 }, scope: "accommodation",
  bookFrom: "2026-11-01", bookTo: "2026-11-30", stayFrom: "2026-11-01", stayTo: "2026-12-20", minNights: 2, maxSaving: 3000,
  usageLimit: 500, discountBudget: 80000, used: 35, discountGranted: 66450, held: 3, heldDiscount: 5400,
};

const VILLAS = {
  moss: { name: "Mossbell Garden Suite", price: 4500, image: properties[1]?.images ?? [] },
  tide: { name: "Tideglass Pool Residence", price: 8500, image: properties[0]?.images ?? [] },
  canopy: { name: "Canopy Halo Loft", price: 12000, image: properties[2]?.images ?? [] },
};

type Case = { id: string; label: string; villa: keyof typeof VILLAS; checkIn: string; checkOut: string; code: string | null; phase?: CouponPhase; notice?: CouponNotice; open?: boolean; source?: "link" | "typed" };

const CASES: Case[] = [
  { id: "collapsed", label: "Have a code?", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: null },
  { id: "entry", label: "Entry open", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: null, open: true },
  { id: "applied", label: "Applied (link)", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DCNT-F1-20", source: "link" },
  { id: "worse", label: "Direct better", villa: "canopy", checkIn: "2026-11-12", checkOut: "2026-11-15", code: "DCNT-F1-20" },
  { id: "min", label: "Min nights", villa: "tide", checkIn: "2026-11-12", checkOut: "2026-11-13", code: "DCNT-F1-20" },
  { id: "outside", label: "Outside dates", villa: "moss", checkIn: "2026-12-22", checkOut: "2026-12-24", code: "DCNT-F1-20" },
  { id: "unknown", label: "Unknown code", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DNCT-F1-20", phase: { kind: "rejected", problem: { code: "not_found" } } },
  { id: "expired", label: "Expired", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DCNT-SK-25", phase: { kind: "rejected", problem: { code: "expired", endedOn: "2026-04-20" } } },
  { id: "spa", label: "Spa code", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DCNT-SPA-500", phase: { kind: "rejected", problem: { code: "nothing_eligible" } } },
  { id: "sold", label: "Sold out", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DCNT-FLASH-30", phase: { kind: "rejected", problem: { code: "sold_out" } } },
  { id: "checking", label: "Checking", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DCNT-F1-20", phase: { kind: "checking" } },
  { id: "error", label: "Check failed", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: "DCNT-F1-20", phase: { kind: "error" } },
  { id: "removed", label: "Removed", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: null, notice: { kind: "removed", code: "DCNT-F1-20", source: "typed" } },
  { id: "ranout", label: "Ran out at create", villa: "moss", checkIn: "2026-11-12", checkOut: "2026-11-14", code: null, notice: { kind: "ran_out", code: "DCNT-F1-20", detail: "This code has been fully used" } },
];

function quote(c: Case): OfferResult {
  const nights = (Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86_400_000;
  return evaluateOffer({
    lines: [{ id: "a", kind: "accommodation", propertySlug: c.villa, checkIn: c.checkIn, checkOut: c.checkOut, nights, amount: VILLAS[c.villa].price * nights }],
    directDiscountPercent: 15,
    today: "2026-11-07",
    coupon: F1,
  });
}

const LEDGER: RedemptionRow[] = [
  { state: "held", discount: 1800, guest: "Maya Chen", conf: "CONF-2026-H7Q2KD", in: "2026-11-12", out: "2026-11-14", at: "2026-11-07T03:42:00Z" },
  { state: "consumed", discount: 3000, guest: "Daniel Okafor", conf: "CONF-2026-R2KX9P", in: "2026-11-20", out: "2026-11-22", at: "2026-11-07T02:58:00Z" },
  { state: "released", discount: 2700, guest: "Sofia Rossi", conf: "CONF-2026-5VN3QA", in: "2026-11-15", out: "2026-11-18", at: "2026-11-07T02:31:00Z" },
  { state: "consumed", discount: 3000, guest: "Kenji Watanabe", conf: "CONF-2026-W8TC3M", in: "2026-12-01", out: "2026-12-05", at: "2026-11-06T11:20:00Z", overLimit: true },
  { state: "reversed", discount: 1800, guest: "Léa Martin", conf: "CONF-2026-8JD4WE", in: "2026-11-09", out: "2026-11-11", at: "2026-11-06T08:05:00Z" },
].map((item, index) => ({
  _id: `r${index}`, _creationTime: 0, couponId: "c1", couponVersion: 1, code: "DCNT-F1-20", bookingId: `b${index}`,
  state: item.state, discount: item.discount, createdAt: Date.parse(item.at), updatedAt: Date.parse(item.at),
  ...(item.overLimit ? { overLimit: true } : {}),
  booking: { guestName: item.guest, checkIn: item.in, checkOut: item.out, confirmationCode: item.conf },
})) as unknown as RedemptionRow[];

export function MarketingR2Preview() {
  const [caseId, setCaseId] = useState("applied");
  const [dark, setDark] = useState(false);
  const c = CASES.find((item) => item.id === caseId) ?? CASES[0];
  const villaT = useTranslations("Villa");
  const copy = useCouponCopy("THB");
  const v = VILLAS[c.villa];
  const result = quote(c);
  const nights = (Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86_400_000;
  const subtotal = v.price * nights;
  const direct = Math.round(subtotal * 0.15);
  const phase = c.phase ?? couponPhase(c.code, c.code ? { status: "ready", result } : { status: "idle" });
  const price = stayPrice({ subtotal, directDiscount: direct, code: c.code, offer: phase.kind === "applied" ? phase.result : null });
  const noteMessage = summaryNote(c.code, phase, copy.problemText);
  const note = noteMessage ? copy.text(noteMessage) : null;
  const property: BookingProperty = {
    ...(properties[1] as BookingProperty), id: c.villa, slug: c.villa, name: v.name, pricePerNight: v.price, images: v.image,
    currency: "THB", directDiscountPercent: 15, source: "demo",
  };
  const noop = () => undefined;

  return (
    <div className={cn(dark && "dark")}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="sticky top-0 z-30 border-b border-dashed border-blue-300 bg-blue-50/95 px-4 py-2 text-xs dark:border-blue-400/40 dark:bg-blue-950/90">
          <p className="font-semibold text-blue-900 dark:text-blue-100">TEMPORARY dev harness · marketing R2a · delete before merge</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CASES.map((item) => (
              <button key={item.id} type="button" onClick={() => setCaseId(item.id)} aria-pressed={item.id === caseId} className={cn("rounded-full border px-2.5 py-1", item.id === caseId ? "border-blue-700 bg-blue-700 text-white" : "border-blue-300 bg-white text-blue-900 dark:bg-transparent dark:text-blue-100")}>
                {item.label}
              </button>
            ))}
            <button type="button" onClick={() => setDark((value) => !value)} className="rounded-full border border-blue-300 px-2.5 py-1 text-blue-900 dark:text-blue-100">
              {dark ? "Light" : "Dark"}
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">Guest · review step</p>
          <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_360px]">
            <Card className="min-w-0 p-5 md:p-7">
              <ReviewPanel
                property={property}
                guests={2}
                nights={nights}
                checkIn={c.checkIn}
                checkOut={c.checkOut}
                bookingMode="live"
                price={<PriceLines currency="THB" priceLabel={`${copy.format.money(v.price)} ${villaT("perNight")} x ${nights}`} subtotal={price.subtotal} lines={price.lines} total={price.total} />}
                coupon={
                  <CouponField
                    code={c.code}
                    source={c.source ?? "typed"}
                    phase={phase}
                    draft={c.code ?? ""}
                    open={Boolean(c.open)}
                    entryError={null}
                    notice={c.notice ?? null}
                    currency="THB"
                    onDraftChange={noop}
                    onOpenChange={noop}
                    onApply={noop}
                    onRemove={noop}
                    onUndo={noop}
                    onRetry={noop}
                    onAddNights={noop}
                    onChangeStay={noop}
                  />
                }
              />
            </Card>
            <BookingPriceSummary property={property} nights={nights} subtotal={price.subtotal} lines={price.lines} total={price.total} note={note} />
          </div>

          <p className="mt-12 text-xs font-semibold uppercase tracking-[0.25em] text-gold">Guest · pay and success</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-xl">
              <h2 className="font-serif text-3xl font-semibold">Confirm payment</h2>
              <BookedPrice
                className="mt-3"
                booking={{ subtotal: 9000, discountAmount: 1800, total: 7200, currency: "THB", paymentStatus: "pending", status: "pending", promotion: { code: "DCNT-F1-20", discount: 1800 } }}
              />
              <Alert variant="warning" className="mt-3">
                <AlertDescription>{copy.text({ key: "totalChanged", values: { total: "฿7,650" } })}</AlertDescription>
              </Alert>
            </div>
            <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
              <h2 className="font-serif text-3xl font-semibold">Booking confirmed</h2>
              <BookedPrice
                showSaving
                className="mt-4"
                booking={{ subtotal: 9000, discountAmount: 1800, total: 7200, currency: "THB", paymentStatus: "paid", status: "confirmed", promotion: { code: "DCNT-F1-20", discount: 1800 } }}
              />
              <BookedPrice className="mt-4" booking={{ subtotal: 17000, discountAmount: 2550, total: 14450, currency: "THB", paymentStatus: "paid", status: "confirmed" }} />
            </div>
          </div>

          <p className="mt-12 text-xs font-semibold uppercase tracking-[0.25em] text-gold">Admin · coupon detail aside and new booking</p>
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="grid gap-4">
              <section className="border border-border bg-card p-4 text-sm">
                <p className="text-xs text-muted-foreground">Summary · Uses</p>
                <p className="tabular-nums">{usageWithHeld(35, 3, 500)}</p>
                <p className="text-xs text-muted-foreground">35 paid · 3 held by unpaid bookings, back if they expire</p>
              </section>
              <section className="max-w-md border border-border bg-card p-4">
                <p className="mb-2 text-sm font-medium">New booking · coupon verdict</p>
                <QuoteVerdictBox result={result}>
                  <p className="mt-1 text-xs text-muted-foreground">Total ฿{result.total.toLocaleString("en-US")}</p>
                </QuoteVerdictBox>
              </section>
            </div>
            <CouponLedger code="DCNT-F1-20" redemptions={LEDGER} />
          </div>
        </div>
      </div>
    </div>
  );
}
