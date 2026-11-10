"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useMarketingAccess } from "./MarketingAccess";
import { ADMIN_MARKETING_PAGES, adminMarketingPath } from "../admin-routes";

/**
 * The Marketing pages as an underlined row of links (same look as the staff section tabs),
 * so phones, where the sidebar is behind Menu, can switch between them.
 */
export function MarketingSectionNav({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const { capabilities } = useMarketingAccess();
  return (
    <>
      <nav aria-label="Marketing pages" className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
        <ul className="flex max-w-full gap-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]">
          {ADMIN_MARKETING_PAGES.filter(({ id }) => id !== "access" || capabilities.manageAccess).map(({ id, label }) => {
            const current = segment === id;
            return (
              <li key={id} className="shrink-0">
                <Link
                  href={adminMarketingPath(id)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </>
  );
}
