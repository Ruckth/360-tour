"use client";

import type { Id } from "convex/_generated/dataModel";
import { ChevronRight, Plus, TicketPercent } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedTabs } from "../SegmentedTabs";
import { StatusBadge } from "../StatusBadge";
import { EmptyState, SearchBox, SkeletonRows } from "../admin-bulk";
import { FirstRunEmpty, UsageBar, countTabs } from "./MarketingBits";
import { COUPON_STATE, benefitLabel, couponState, formatRange, scopeLabel, thb, usageLabel, type CouponState } from "./marketing-format";
import type { CampaignRow, CouponRow, MarketingProperty } from "./types";

type Tab = "all" | CouponState;
const TAB_ORDER: CouponState[] = ["active", "scheduled", "sold_out", "budget_used", "expired", "paused", "draft", "archived"];
const ALL = "all";
const NONE = "none";

type CouponsViewProps = {
  coupons?: CouponRow[];
  campaigns?: CampaignRow[];
  properties?: MarketingProperty[];
  today: string;
  couponHref: (couponId: Id<"coupons">) => string;
  newCouponHref: string;
};

export function CouponsView({ coupons, campaigns, properties, today, couponHref, newCouponHref }: CouponsViewProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [campaign, setCampaign] = useState<string>(ALL);

  const all = coupons ?? [];
  const stateOf = (coupon: CouponRow) => couponState(coupon, today);
  const villaName = (slug: string) => properties?.find((property) => property.slug === slug)?.name ?? slug;
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  const shown = all
    .filter((coupon) => (tab === "all" ? coupon.status !== "archived" : stateOf(coupon) === tab))
    .filter((coupon) => campaign === ALL || (campaign === NONE ? !coupon.campaignId : coupon.campaignId === campaign))
    .filter((coupon) => !q || [coupon.code, coupon.campaignName ?? "", benefitLabel(coupon.rules.benefit)].join("").toLowerCase().replace(/\s+/g, "").includes(q));
  const tabs: { value: Tab; label: string; n: number }[] = [
    { value: "all", label: "All", n: all.filter((coupon) => coupon.status !== "archived").length },
    ...TAB_ORDER.map((state) => ({ value: state, label: COUPON_STATE[state].label, n: all.filter((coupon) => stateOf(coupon) === state).length })).filter(
      (item) => item.n > 0 || item.value === "active" || item.value === tab,
    ),
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-4 sm:px-6">
      <section className="min-w-0 border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <p className="min-w-60 flex-1 text-sm text-muted-foreground">
            Codes guests type at checkout or show at reception. The saved rules decide the discount; the code is only a label.
          </p>
          {all.length ? (
            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
              <SearchBox value={query} onChange={setQuery} label="Search codes" />
              <Select value={campaign} onValueChange={setCampaign}>
                <SelectTrigger className="h-9 w-full rounded-lg sm:w-52" aria-label="Campaign">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All campaigns</SelectItem>
                  {(campaigns ?? []).map((item) => (
                    <SelectItem key={item._id} value={item._id}>
                      {item.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NONE}>No campaign</SelectItem>
                </SelectContent>
              </Select>
              <ButtonLink href={newCouponHref} size="sm" className="w-full sm:w-auto">
                <Plus aria-hidden className="size-4" />
                New coupon
              </ButtonLink>
            </div>
          ) : null}
        </div>

        {coupons === undefined ? (
          <SkeletonRows label="Loading coupons" />
        ) : all.length === 0 ? (
          <FirstRunEmpty
            icon={TicketPercent}
            title="No coupons yet"
            description={
              <>
                A coupon is a code guests type at checkout, like <span className="font-mono font-semibold text-foreground">DCNT-F1-20</span>. The rules you
                save decide the discount; the code is only a label.
              </>
            }
          >
            <ButtonLink href={newCouponHref} size="sm">
              <Plus aria-hidden className="size-4" />
              New coupon
            </ButtonLink>
            <p className="mt-2 max-w-md text-xs text-muted-foreground">You don’t need one to track links: website guests already get the direct offer.</p>
          </FirstRunEmpty>
        ) : (
          <>
            <div className="px-4 pt-3">
              <SegmentedTabs
                label="Coupon status"
                controls="marketing-coupons-list"
                value={tab}
                onValueChange={setTab}
                tabs={countTabs(tabs)}
              />
            </div>
            <div id="marketing-coupons-list">
              {shown.length === 0 ? (
                <EmptyState
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTab("all");
                        setQuery("");
                        setCampaign(ALL);
                      }}
                    >
                      Show all coupons
                    </Button>
                  }
                >
                  {q ? `No coupons match “${query.trim()}”.` : "No coupons here."}
                </EmptyState>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="admin-eyebrow border-b border-border bg-muted/40">
                        <tr>
                          <th scope="col" className="px-4 py-3">
                            Code
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Benefit
                          </th>
                          <th scope="col" className="hidden px-4 py-3 lg:table-cell">
                            Scope
                          </th>
                          <th scope="col" className="hidden px-4 py-3 xl:table-cell">
                            Booking window
                          </th>
                          <th scope="col" className="w-40 px-4 py-3">
                            Usage
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Status
                          </th>
                          <th scope="col" className="w-10 py-3 pe-3">
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((coupon) => {
                          const state = stateOf(coupon);
                          return (
                            <tr key={coupon._id} className="border-b border-border align-top last:border-b-0 hover:bg-muted/30">
                              <td className="px-4 py-3">
                                <Link
                                  href={couponHref(coupon._id)}
                                  className="rounded font-mono font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {coupon.code}
                                </Link>
                                <span className="block text-xs text-muted-foreground">
                                  {coupon.campaignName ?? "No campaign"} · v{coupon.currentVersion}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-medium text-foreground">{benefitLabel(coupon.rules.benefit)}</span>
                                {coupon.rules.benefit.kind === "percent" && coupon.rules.maxSaving ? (
                                  <span className="block text-xs text-muted-foreground">up to {thb(coupon.rules.maxSaving)}</span>
                                ) : null}
                              </td>
                              <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{scopeLabel(coupon.rules.scope, coupon.rules.propertySlugs, villaName)}</td>
                              <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground xl:table-cell">{formatRange(coupon.rules.bookFrom, coupon.rules.bookTo)}</td>
                              <td className="px-4 py-3">
                                <div className="grid gap-1.5">
                                  <span className="text-xs tabular-nums text-foreground">{usageLabel(coupon.used, coupon.rules.usageLimit)}</span>
                                  <UsageBar used={coupon.used} limit={coupon.rules.usageLimit} label={`${coupon.code} uses`} />
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge {...COUPON_STATE[state]} />
                              </td>
                              <td className="py-2 pe-3 text-right">
                                <ButtonLink
                                  href={couponHref(coupon._id)}
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Open ${coupon.code}`}
                                  className="size-9 text-muted-foreground hover:text-foreground"
                                >
                                  <ChevronRight aria-hidden className="size-4" />
                                </ButtonLink>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y divide-border md:hidden">
                    {shown.map((coupon) => {
                      const state = stateOf(coupon);
                      return (
                        <li key={coupon._id}>
                          <Link
                            href={couponHref(coupon._id)}
                            className="grid gap-2 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          >
                            <span className="flex items-start gap-2">
                              <span className="min-w-0 flex-1">
                                <span className="block break-all font-mono text-sm font-semibold text-foreground">{coupon.code}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {benefitLabel(coupon.rules.benefit)} · {scopeLabel(coupon.rules.scope, coupon.rules.propertySlugs, villaName)}
                                </span>
                              </span>
                              <StatusBadge {...COUPON_STATE[state]} />
                            </span>
                            <span className="grid gap-1.5">
                              <span className="flex justify-between gap-2 text-xs">
                                <span className="text-muted-foreground">{formatRange(coupon.rules.bookFrom, coupon.rules.bookTo)}</span>
                                <span className="tabular-nums text-foreground">{usageLabel(coupon.used, coupon.rules.usageLimit)}</span>
                              </span>
                              <UsageBar used={coupon.used} limit={coupon.rules.usageLimit} label={`${coupon.code} uses`} />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              One coupon per booking: guests always get the better of the direct offer or the code. A refund doesn’t give a use back.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
