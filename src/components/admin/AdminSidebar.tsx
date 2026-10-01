"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, adminNavItem } from "@/components/admin/admin-routes";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

export function AdminSidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const activeHref = adminNavItem(pathname)?.href;
  const { isMobile, setOpenMobile } = useSidebar();
  const profile = useQuery(api.settings.publicProfile, {});

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="p-3">
        <div className="flex h-12 items-center gap-3 rounded-lg px-1 group-data-[collapsible=icon]:justify-center">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Shield aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold">{profile?.businessName ?? "\u00a0"}</span>
            <span className="block truncate text-xs text-sidebar-foreground/70">Concierge operations</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="Admin sections">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_NAV.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={href === activeHref} tooltip={label}>
                    <Link
                      href={href}
                      aria-current={href === activeHref ? "page" : undefined}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <SidebarSeparator className="mx-0" />
        <div className="flex items-center gap-3 px-1 py-2 group-data-[collapsible=icon]:justify-center">
          <UserButton />
          <span className="min-w-0 truncate text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            {userEmail ?? "Admin account"}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
