"use client";

// TEMPORARY — QA harness only, delete with this folder (see page.tsx).

import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CampaignsView } from "@/components/admin/marketing/CampaignsView";
import { CouponEditor } from "@/components/admin/marketing/CouponEditor";
import { CouponsView } from "@/components/admin/marketing/CouponsView";
import { LinksView } from "@/components/admin/marketing/LinksView";
import { cn } from "@/lib/utils";
import { derive, fixtureActions } from "./fixture-backend";
import { BRAND, ORIGIN, PROPERTIES, TODAY, emptyStore, sampleStore, type Store } from "./fixtures";

type Screen = "links" | "campaigns" | "coupons" | "coupon";
type DataMode = "sample" | "empty" | "loading";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "campaigns", label: "Campaigns" },
  { id: "links", label: "Links & QR" },
  { id: "coupons", label: "Coupons" },
];

function Chip({ active, onClick, children, href }: { active?: boolean; onClick?: () => void; href?: string; children: ReactNode }) {
  const className = cn(
    "inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:bg-muted",
  );
  if (href)
    return (
      <Link href={href} className={className} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {children}
    </button>
  );
}

export function MarketingPreview() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const screen = (params.get("screen") as Screen | null) ?? "links";
  const couponId = params.get("id") ?? "new";
  const href = (next: Record<string, string>) => `${pathname}?${new URLSearchParams(next).toString()}`;

  // A plain mutable box: the fake backend reads and writes it, and a counter re-renders.
  const [box] = useState<{ store: Store; failing: boolean }>(() => ({ store: sampleStore(), failing: false }));
  const [, setRevision] = useState(0);
  const [mode, setMode] = useState<DataMode>("sample");
  const [failing, setFailingState] = useState(false);
  const [dark, setDark] = useState(false);
  const [actions] = useState(() =>
    fixtureActions(
      () => box.store,
      (next) => {
        box.store = next;
        setRevision((n) => n + 1);
      },
      () => box.failing,
    ),
  );
  const setFailing = (value: boolean) => {
    box.failing = value;
    setFailingState(value);
  };

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  function toggleTheme() {
    document.documentElement.classList.toggle("dark", !dark);
    setDark(!dark);
  }

  function switchData(next: DataMode) {
    setMode(next);
    if (next === "loading") return;
    box.store = next === "empty" ? emptyStore() : sampleStore();
    setRevision((n) => n + 1);
  }

  const data = derive(box.store);
  const loading = mode === "loading";
  const list = <T,>(value: T) => (loading ? undefined : value);
  const couponHref = (id: string) => href({ screen: "coupon", id });
  const sectionTitle = SCREENS.find((item) => item.id === (screen === "coupon" ? "coupons" : screen))?.label;
  const f1 = data.coupons.find((coupon) => coupon.code === "DCNT-F1-20");

  return (
    <ConfirmProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <div className="border-b border-dashed border-amber-400 bg-amber-50 px-4 py-2 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">Temporary preview · sample data</span>
            <span className="text-xs">Marketing R1 admin views on in-memory data. Not linked anywhere; delete src/app/dev/marketing-preview before shipping.</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide">Screen</span>
            {SCREENS.map((item) => (
              <Chip key={item.id} href={href({ screen: item.id })} active={screen === item.id}>
                {item.label}
              </Chip>
            ))}
            {f1 ? (
              <Chip href={couponHref(f1._id)} active={screen === "coupon" && couponId === f1._id}>
                Coupon detail
              </Chip>
            ) : null}
            <Chip href={couponHref("new")} active={screen === "coupon" && couponId === "new"}>
              New coupon
            </Chip>
            <span className="ms-2 text-[11px] font-semibold uppercase tracking-wide">Data</span>
            {(["sample", "empty", "loading"] as const).map((item) => (
              <Chip key={item} active={mode === item} onClick={() => switchData(item)}>
                {item === "sample" ? "Sample" : item === "empty" ? "First run" : "Loading"}
              </Chip>
            ))}
            <span className="ms-2 text-[11px] font-semibold uppercase tracking-wide">Writes</span>
            <Chip active={!failing} onClick={() => setFailing(false)}>
              Succeed
            </Chip>
            <Chip active={failing} onClick={() => setFailing(true)}>
              Fail
            </Chip>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              className="ms-auto inline-flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {dark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
            </button>
          </div>
        </div>

        {/* Same header as AdminShell. */}
        <header className="flex min-h-16 items-center gap-3 border-b border-border bg-card/95 px-4 sm:px-6">
          <div className="min-w-0">
            <p className="admin-eyebrow">Concierge operations</p>
            <h1 className="truncate font-serif text-2xl font-semibold tracking-tight text-foreground">Marketing</h1>
          </div>
        </header>
        <nav aria-label="Marketing pages" className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
          <ul className="flex max-w-full gap-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]">
            {SCREENS.map((item) => (
              <li key={item.id} className="shrink-0">
                <Link
                  href={href({ screen: item.id })}
                  aria-current={sectionTitle === item.label ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-medium pointer-coarse:min-h-11",
                    sectionTitle === item.label ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {screen === "links" ? (
          <LinksView
            links={list(data.links)}
            campaigns={list(data.campaigns)}
            coupons={list(data.coupons)}
            properties={list(PROPERTIES)}
            origin={ORIGIN}
            brand={BRAND}
            today={TODAY}
            campaignsHref={href({ screen: "campaigns" })}
            actions={actions}
          />
        ) : screen === "campaigns" ? (
          <CampaignsView
            campaigns={list(data.campaigns)}
            links={list(data.links)}
            coupons={list(data.coupons)}
            today={TODAY}
            linksHref={href({ screen: "links" })}
            couponHref={couponHref}
            actions={actions}
          />
        ) : screen === "coupons" ? (
          <CouponsView
            coupons={list(data.coupons)}
            campaigns={list(data.campaigns)}
            properties={list(PROPERTIES)}
            today={TODAY}
            couponHref={couponHref}
            newCouponHref={couponHref("new")}
          />
        ) : (
          <CouponEditor
            key={couponId}
            isNew={couponId === "new"}
            detail={loading ? undefined : couponId === "new" ? undefined : data.detail(couponId)}
            coupons={list(data.coupons)}
            campaigns={list(data.campaigns)}
            properties={list(PROPERTIES)}
            today={TODAY}
            listHref={href({ screen: "coupons" })}
            actions={actions}
            onCreated={(id) => router.replace(couponHref(id))}
          />
        )}
      </div>
    </ConfirmProvider>
  );
}
