"use client";

import { Menu, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, ADMIN_TAB_BAR, adminNavItem, type AdminNavItem } from "@/components/admin/admin-routes";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** Asks the sidebar to open with its search field focused (it owns the field and the results). */
export const OPEN_ADMIN_SEARCH = "admin:open-search";
const openSearch = () => window.dispatchEvent(new Event(OPEN_ADMIN_SEARCH));

type TileProps = { icon: LucideIcon; label: string; current?: boolean; className?: string };

const tile = (current: boolean | undefined, className?: string) =>
  cn(
    "flex flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    current
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
    className,
  );

function TileBody({ icon: Icon, label, fullLabel }: TileProps & { fullLabel?: string }) {
  return (
    <>
      <Icon aria-hidden="true" className="size-5" />
      <span className="px-0.5 text-center leading-4">
        {label}
        {/* The visible short name stays first in the accessible name (WCAG 2.5.3). */}
        {fullLabel && fullLabel !== label ? <span className="sr-only"> ({fullLabel})</span> : null}
      </span>
    </>
  );
}

function SectionTile({ item, current, className }: { item: AdminNavItem; current: boolean; className?: string }) {
  const label = item.shortLabel ?? item.label;
  return (
    <Link href={item.href} aria-current={current ? "page" : undefined} title={item.label} className={tile(current, className)}>
      <TileBody icon={item.icon} label={label} fullLabel={item.label} />
    </Link>
  );
}

function ActionTile({ onClick, className, ...body }: TileProps & { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={tile(body.current, className)}>
      <TileBody {...body} />
    </button>
  );
}

/**
 * iPad navigation (768–1279px): a rail of every section with short labels, always visible.
 * Menu expands it to the full sidebar, with sub-pages, search and the account.
 */
export function AdminRail() {
  const current = adminNavItem(usePathname())?.href;
  const { setOpenMobile } = useSidebar();
  return (
    <nav
      aria-label="Admin sections"
      className="sticky top-0 hidden h-dvh w-[5.5rem] shrink-0 flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sidebar-foreground md:flex xl:hidden"
    >
      <ActionTile icon={Menu} label="Menu" onClick={() => setOpenMobile(true)} className="min-h-14 shrink-0" />
      <ActionTile icon={Search} label="Search" onClick={openSearch} className="min-h-14 shrink-0" />
      <div aria-hidden="true" className="mx-2 my-1 h-px shrink-0 bg-sidebar-border" />
      {ADMIN_NAV.map((item) => (
        <SectionTile key={item.href} item={item} current={item.href === current} className="min-h-14 shrink-0" />
      ))}
    </nav>
  );
}

/**
 * Phone navigation (below 768px): a bottom tab bar with the daily sections, Search and Menu.
 * Menu lists every section, in the sidebar's order, and is marked current on the pages it holds.
 */
export function AdminTabBar() {
  const current = adminNavItem(usePathname())?.href;
  const { setOpenMobile } = useSidebar();
  const inMenu = !ADMIN_TAB_BAR.some((item) => item.href === current);
  return (
    <nav
      aria-label="Admin sections"
      className="sticky bottom-0 z-30 mt-auto grid shrink-0 grid-cols-5 gap-1 border-t border-border bg-sidebar/95 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-sidebar-foreground backdrop-blur md:hidden"
    >
      {ADMIN_TAB_BAR.map((item) => (
        <SectionTile key={item.href} item={item} current={item.href === current} className="min-h-14" />
      ))}
      <ActionTile icon={Search} label="Search" onClick={openSearch} className="min-h-14" />
      <ActionTile icon={Menu} label="Menu" current={inMenu} onClick={() => setOpenMobile(true)} className="min-h-14" />
    </nav>
  );
}
