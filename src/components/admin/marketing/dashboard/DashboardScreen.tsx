"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/lib/staff-bookings";
import { receiptPath } from "@/components/checkout/checkout-source";
import type { AdminProperty } from "../../admin-bookings-shared";
import { adminMarketingPath } from "../../admin-routes";
import { BookingSheet } from "../../BookingSheet";
import { useMarketingAccess } from "../MarketingAccess";
import { bangkokToday, marketingErrorText } from "../marketing-format";
import { DEFAULT_REQUEST, DashboardView, type ReportRequest, type ReportState } from "./DashboardView";
import { presetRange } from "./report-model";

/**
 * The dashboard wired to Convex. The report is a one-off read (not a subscription): it's the
 * largest read in the admin, so it runs when the dates or basis change, after a spend change, or on
 * Refresh, and the page shows its as-of time.
 */
export function DashboardScreen() {
  const access = useMarketingAccess();
  const convex = useConvex();
  const today = bangkokToday(useNow());
  const [request, setRequest] = useState<ReportRequest>(() => DEFAULT_REQUEST(today));
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [stay, setStay] = useState<Id<"bookings"> | null>(null);
  const saveSpend = useMutation(api.marketing.report.saveSpend);
  const properties = useQuery(api.catalog.properties.adminList, access.role === "admin" && stay ? {} : "skip");

  // A preset follows the calendar: when the Bangkok day changes, its dates move on and the report is read again.
  const preset = request.range.preset;
  const range = preset === "custom" ? request.range : { preset, ...presetRange(preset, today) };
  const { from, to } = range;
  const basis = request.basis;
  useEffect(() => {
    let live = true;
    setState((current) => (current.status === "ready" ? { status: "ready", report: current.report, refreshing: true } : { status: "loading" }));
    convex.query(api.marketing.report.getReport, { from, to, basis }).then(
      (report) => live && setState({ status: "ready", report }),
      (error: unknown) => {
        if (!live) return;
        const message = marketingErrorText(error, "The report didn’t load.");
        // A failed re-read of the same dates keeps the figures already on screen.
        setState((current) =>
          current.status === "ready" && current.report.from === from && current.report.to === to && current.report.basis === basis
            ? { status: "ready", report: current.report, refreshError: message }
            : { status: "error", message },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [convex, from, to, basis, nonce]);

  const sheetProperties = useMemo<AdminProperty[]>(
    () =>
      (properties ?? []).map((p) => ({
        _id: p._id,
        slug: p.slug,
        name: p.name,
        ...(p.images[0] ? { imageUrl: p.images[0] } : {}),
        maxGuests: p.maxGuests,
        status: p.status,
        pricePerNight: p.pricePerNight,
        directDiscountPercent: p.directDiscountPercent,
        currency: p.currency,
      })),
    [properties],
  );

  return (
    <>
      <DashboardView
        request={{ ...request, range }}
        onRequestChange={setRequest}
        state={state}
        onRetry={() => setNonce((n) => n + 1)}
        today={today}
        campaignsHref={adminMarketingPath("campaigns")}
        linksHref={adminMarketingPath("links")}
        orderHref={receiptPath}
        onOpenStay={(id) => { if (access.role === "admin") setStay(id as Id<"bookings">); }}
        onSaveSpend={async ({ id, campaignId, amount, from: spendFrom, to: spendTo, note }) => {
          if (!access.capabilities.spend) throw new Error("Your Marketing role cannot manage spend.");
          await saveSpend({ id, campaignId, amount, from: spendFrom, to: spendTo, note });
          setNonce((n) => n + 1);
        }}
      />
      {/* Hotel bookings has no deep link, so a stay opens the same booking sheet here. */}
      {access.role === "admin" ? <BookingSheet bookingId={stay} properties={sheetProperties} onClose={() => setStay(null)} /> : null}
    </>
  );
}
