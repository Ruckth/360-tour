"use client";

import { UserButton } from "@clerk/nextjs";
import { BedDouble, CalendarClock, HelpCircle, MessageCircle, Shield } from "lucide-react";
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

export type AdminDashboardView = "chats" | "hotel" | "staff" | "questions";

export const ADMIN_VIEW_TITLES: Record<AdminDashboardView, string> = {
  chats: "Chats",
  hotel: "Hotel bookings",
  staff: "Staff bookings",
  questions: "Questions",
};

export function AdminSidebar({
  view,
  onViewChange,
  userEmail,
}: {
  view: AdminDashboardView;
  onViewChange: (view: AdminDashboardView) => void;
  userEmail?: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  function selectView(nextView: AdminDashboardView) {
    onViewChange(nextView);
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="p-3">
        <div className="flex h-12 items-center gap-3 rounded-lg px-1 group-data-[collapsible=icon]:justify-center">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Shield aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold">Auralis Cove</span>
            <span className="block truncate text-xs text-sidebar-foreground/70">Concierge operations</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="Admin sections">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={view === "chats"}
                  tooltip="Chats"
                  onClick={() => selectView("chats")}
                >
                  <MessageCircle aria-hidden="true" />
                  <span>Chats</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={view === "hotel"}
                  tooltip="Hotel bookings"
                  onClick={() => selectView("hotel")}
                >
                  <BedDouble aria-hidden="true" />
                  <span>Hotel bookings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={view === "staff"}
                  tooltip="Staff bookings"
                  onClick={() => selectView("staff")}
                >
                  <CalendarClock aria-hidden="true" />
                  <span>Staff bookings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={view === "questions"}
                  tooltip="Questions"
                  onClick={() => selectView("questions")}
                >
                  <HelpCircle aria-hidden="true" />
                  <span>Questions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
