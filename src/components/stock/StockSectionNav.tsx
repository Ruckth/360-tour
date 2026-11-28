"use client";

import type { ReactNode } from "react";
import { ADMIN_STOCK_PAGES, adminStockPath } from "@/components/admin/admin-routes";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { BranchChoices } from "@/components/admin/branch/BranchScreens";
import { OpenHoldBadge } from "./open-hold-count";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useSelectedLayoutSegment } from "@/platform/navigation";

/** The local links are visible wherever the sidebar does not already show Stock pages. */
export function StockSectionShell({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment("/admin/stock");
  const { current: branch, branches } = useAdminBranch();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border xl:group-has-[[data-stock-pages]]/sidebar-wrapper:hidden">
        <div className="mx-auto flex w-full max-w-7xl px-4 sm:px-6">
          <nav aria-label="Stock pages" className="min-w-0 w-full">
            <ul className="flex max-w-full flex-wrap justify-between sm:justify-start sm:gap-x-6">
              {ADMIN_STOCK_PAGES.map(({ id, label }) => {
                const current = segment === id;
                return (
                  <li key={id} className="shrink-0">
                    <Link
                      href={adminStockPath(id)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center justify-center whitespace-nowrap border-b-2 min-h-11 min-w-11 px-0.5 text-xs sm:px-1 sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        current
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {id === "expansion" ? <><span className="max-sm:sr-only sm:mr-1">Transfers &amp; </span>Lots</> : label}
                      {id === "purchasing" ? <OpenHoldBadge compact /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>

      {!branch ? (
        <section aria-labelledby="stock-choose-branch" className="mx-auto grid w-full max-w-7xl gap-2 px-4 py-5 sm:px-6">
          <h2 id="stock-choose-branch" className="text-lg font-semibold">Select a working branch</h2>
          {branches.length ? <div className="max-w-md"><BranchChoices /></div> : (
            <p className="text-sm text-muted-foreground">Ask a company owner to assign you a branch to use Stock.</p>
          )}
        </section>
      ) : (
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 pt-3 pb-5 sm:px-6 sm:pt-5">
          {children}
        </div>
      )}
    </div>
  );
}
