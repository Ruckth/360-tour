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
import { DashboardView, DEFAULT_REQUEST, initialRequest, type ReportRequest, type ReportState } from "./DashboardView";
import { customRangeProblem, PRESETS, presetRange } from "./report-model";

export function dashboardRequest(search: URLSearchParams, today: string, fallback: ReportRequest): ReportRequest {
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const preset = PRESETS.find((choice) => choice.id === search.get("preset"));
  const basis = search.get("basis");
  const property = search.get("property") ?? "";
  const touch = search.get("touch");
  const breakdown = search.get("breakdown");
  const suppliedDates = search.has("from") || search.has("to") || search.has("preset");
  const exactPreset = preset && presetRange(preset.id, today);
  const range = !suppliedDates ? fallback.range
    : customRangeProblem(from, to, today) ? DEFAULT_REQUEST(today).range
    : { preset: exactPreset?.from === from && exactPreset.to === to ? preset?.id ?? "custom" : "custom" as const, from, to };
  return {
    range,
    basis: basis === "cash" ? "cash" : "cohort",
    property: /^[a-z0-9]{20,40}$/.test(property) ? property : "all",
    touch: touch === "first" ? "first" : "last",
    breakdown: breakdown === "campaign" || breakdown === "link" || breakdown === "coupon" ? breakdown : "source",
  };
}

/**
 * The dashboard wired to Convex. The report is a one-off read (not a subscription): it's the
 * largest read in the admin, so it runs when the dates or basis change, after a spend change, or on
 * Refresh, and the page shows its as-of time. The range starts where this device left it.
 */
type DashboardScreenProps = { search?: URLSearchParams; onScopeChange?: (params: URLSearchParams) => void };

export function DashboardScreen(props: DashboardScreenProps = {}) {
  const access = useMarketingAccess();
  return <DashboardRead key={`${access.email}:${access.role}`} {...props} />;
}

function DashboardRead({ search, onScopeChange }: DashboardScreenProps) {
  const access = useMarketingAccess();
  const convex = useConvex();
  const today = bangkokToday(useNow());
  const [localRequest, setLocalRequest] = useState(() => initialRequest(today));
  const request = search ? dashboardRequest(search, today, localRequest) : localRequest;
  function setRequest(next: ReportRequest) {
    const params = new URLSearchParams({
      from: next.range.from, to: next.range.to, preset: next.range.preset, basis: next.basis, property: next.property ?? "all",
      touch: next.touch ?? "last", breakdown: next.breakdown ?? "source",
    });
    if (onScopeChange) onScopeChange(params);
    else setLocalRequest(next);
  }
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [stay, setStay] = useState<Id<"bookings"> | null>(null);
  const saveSpend = useMutation(api.marketing.report.saveSpend);
  const properties = useQuery(api.catalog.properties.adminList, access.role === "admin" && stay ? {} : "skip");

  // A preset follows the calendar: when the Bangkok day changes, its dates move on and the report is read again.
  const preset = request.range.preset;
  const range = search?.has("from") || preset === "custom" ? request.range : { preset, ...presetRange(preset, today) };
  const { from, to } = range;
  const basis = request.basis;
  // A new read keeps the same dates' figures on screen while refreshing; other dates start loading.
  const readKey = `${from}|${to}|${basis}|${nonce}`;
  const [shownReadKey, setShownReadKey] = useState(readKey);
  if (shownReadKey !== readKey) {
    setShownReadKey(readKey);
    setState((current) => (current.status === "ready" && current.report.from === from && current.report.to === to && current.report.basis === basis ? { status: "ready", report: current.report, refreshing: true } : { status: "loading" }));
  }
  useEffect(() => {
    let live = true;
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
