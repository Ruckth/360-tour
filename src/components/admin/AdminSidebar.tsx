"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { ChevronRight, Search, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { activeAdminSubLink, adminNavItem, searchAdminNav } from "@/components/admin/admin-routes";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function AdminSidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const router = useRouter();
  const section = adminNavItem(pathname);
  const activeHref = section?.href;
  // Resolved on the whole section, not the filtered results, so searching can't move the highlight.
  const activeSub = section ? activeAdminSubLink(section, pathname, tab) : undefined;
  const { isMobile, setOpen, setOpenMobile, state } = useSidebar();
  const profile = useQuery(api.settings.publicProfile, {});
  const [query, setQuery] = useState("");
  // Sections opened or closed by hand; otherwise only the current section shows its sub-pages.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const search = useRef<HTMLInputElement>(null);
  const [shortcut, setShortcut] = useState("⌘K");
  // Sub-pages are hidden in icon mode, so the section icon carries the highlight there.
  const iconMode = state === "collapsed" && !isMobile;
  const searching = query.trim() !== "";
  const results = searchAdminNav(query);
  const firstHit = results[0]?.children?.[0]?.href ?? results[0]?.href;

  const close = () => {
    setQuery("");
    if (isMobile) setOpenMobile(false);
  };

  const focusSearch = useCallback(() => {
    if (isMobile) setOpenMobile(true);
    else setOpen(true);
    // The field is hidden while the sidebar is collapsed; focus it once it's shown.
    requestAnimationFrame(() => requestAnimationFrame(() => search.current?.focus()));
  }, [isMobile, setOpen, setOpenMobile]);

  useEffect(() => {
    // After mount, so the server render and hydration agree.
    if (!/mac|iphone|ipad/i.test(navigator.platform)) setShortcut("Ctrl K");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // Not behind an open dialog: it couldn't take focus, and would only expand a collapsed sidebar.
      if (document.querySelector('[role="dialog"][data-state="open"]:not([data-mobile]), [role="alertdialog"][data-state="open"]')) return;
      event.preventDefault();
      focusSearch();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  // ReUI c-sidebar-1: inset shell, compact workspace header, grouped nav and account footer.
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-2 p-2">
        <div className="flex h-12 items-center gap-2 rounded-lg px-2 group-data-[collapsible=icon]:justify-center">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Shield aria-hidden="true" className="size-4" />
          </span>
          <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{profile?.businessName ?? " "}</span>
            <span className="block truncate text-xs text-sidebar-foreground/70">Concierge operations</span>
          </span>
        </div>
        <div role="search" className="relative group-data-[collapsible=icon]:hidden">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/60" />
          <SidebarInput
            ref={search}
            type="search"
            value={query}
            placeholder="Search admin…"
            aria-label="Search admin pages"
            aria-keyshortcuts={shortcut === "⌘K" ? "Meta+K" : "Control+K"}
            className={cn("pl-8 pr-10 text-base sm:text-sm [&::-webkit-search-cancel-button]:hidden", isMobile ? "h-10" : "h-9")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searching && firstHit) {
                event.preventDefault();
                router.push(firstHit);
                close();
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
          {!isMobile ? (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-sidebar-border px-1 font-mono text-[10px] text-sidebar-foreground/60">
              {searching ? "↵" : shortcut}
            </kbd>
          ) : null}
        </div>
        {state === "collapsed" && !isMobile ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={`Search (${shortcut})`} onClick={focusSearch}>
                <Search aria-hidden="true" />
                <span>Search</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="Admin sections">
        <SidebarGroup>
          <SidebarGroupLabel>{searching ? "Results" : "Workspace"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {results.map((item) => {
                const { href, label, icon: Icon, children } = item;
                const current = href === activeHref;
                const expanded = searching || (toggled[href] ?? current);
                const subShown = current && expanded && !iconMode && children?.some((child) => child.href === activeSub);
                const highlighted = current && !subShown;
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton asChild isActive={highlighted} tooltip={label} className={cn(isMobile && "h-10", children?.length && "pr-10")}>
                      <Link href={href} aria-current={highlighted ? "page" : undefined} onClick={close}>
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {children?.length && !searching ? (
                      <SidebarMenuAction
                        // A full 40px tap target on phones, centred on the 40px row.
                        className={cn(isMobile && "right-0 top-0! size-10 after:hidden")}
                        aria-label={`${expanded ? "Hide" : "Show"} ${label} pages`}
                        aria-expanded={expanded}
                        onClick={() => setToggled((prev) => ({ ...prev, [href]: !expanded }))}
                      >
                        <ChevronRight aria-hidden="true" className={cn("transition-transform", expanded && "rotate-90")} />
                      </SidebarMenuAction>
                    ) : null}
                    {children?.length && expanded ? (
                      <SidebarMenuSub>
                        {children.map((child) => (
                          <SidebarMenuSubItem key={child.href}>
                            <SidebarMenuSubButton asChild isActive={child.href === activeSub} className={cn(isMobile && "h-10")}>
                              <Link
                                href={child.href}
                                aria-current={child.href === activeSub ? "page" : undefined}
                                onClick={close}
                              >
                                <span>{child.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
            {/* Always mounted, so screen readers announce changes to it. */}
            <p role="status" className={results.length ? "sr-only" : "px-2 py-3 text-sm text-sidebar-foreground/70"}>
              {!searching ? "" : results.length ? `${results.length} ${results.length === 1 ? "section" : "sections"} found` : `No pages match “${query.trim()}”.`}
            </p>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarSeparator className="mx-0" />
        <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center">
          <UserButton />
          <span className="min-w-0 truncate text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            {userEmail ?? "Admin account"}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
