"use client";

import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { ADMIN_STOCK_PAGES, adminStockPath } from "@/components/admin/admin-routes";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { BranchStatePill } from "@/components/admin/branch/branch-pills";
import { Callout } from "@/components/admin/marketing/MarketingBits";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useSelectedLayoutSegment } from "@/platform/navigation";

/**
 * Shared Stock section shell: displays the active working branch context and underlined
 * navigation row for Balances, Activity, Products, Purchasing, and Transfers & Lots.
 */
export function StockSectionShell({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment("/admin/stock");
  const { current: branch } = useAdminBranch();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pt-3 sm:px-6">
          <nav aria-label="Stock pages" className="min-w-0 basis-full sm:flex-1">
            <ul className="flex max-w-full flex-wrap gap-x-3 sm:gap-x-6">
              {ADMIN_STOCK_PAGES.map(({ id, label }) => {
                const current = segment === id;
                return (
                  <li key={id} className="shrink-0">
                    <Link
                      href={adminStockPath(id)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center whitespace-nowrap border-b-2 min-h-11 px-1 sm:pb-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        current
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {branch ? (
            <div className="flex shrink-0 items-center gap-2 pb-2 text-xs text-muted-foreground">
              <MapPin aria-hidden className="size-3.5 shrink-0" />
              <span className="font-medium text-foreground">{branch.name}</span>
              <BranchStatePill state={branch.state} />
            </div>
          ) : null}
        </div>
      </div>

      {!branch ? (
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
          <Callout tone="warning" title="Select a working branch">
            Stock balances, movements, receiving, and purchasing are scoped to a branch. Choose a branch in the sidebar or header to continue.
          </Callout>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-20 sm:px-6 md:pb-8">
          {children}
        </div>
      )}
    </div>
  );
}
