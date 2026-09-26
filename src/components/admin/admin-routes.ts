import type { AdminDashboardView } from "@/components/admin/AdminSidebar";

export type AdminStaffTab = "calendar" | "staff" | "services";

export function adminRoute(pathname: string): { view: AdminDashboardView; staffTab: AdminStaffTab } | null {
  if (pathname === "/admin/chats") return { view: "chats", staffTab: "calendar" };
  if (pathname === "/admin/hotel") return { view: "hotel", staffTab: "calendar" };
  if (pathname === "/admin/questions") return { view: "questions", staffTab: "calendar" };
  if (pathname === "/admin/properties") return { view: "properties", staffTab: "calendar" };
  if (pathname === "/admin/leads") return { view: "leads", staffTab: "calendar" };
  if (pathname === "/admin/staff/calendar") return { view: "staff", staffTab: "calendar" };
  if (pathname === "/admin/staff/staff") return { view: "staff", staffTab: "staff" };
  if (pathname === "/admin/staff/services") return { view: "staff", staffTab: "services" };
  return null;
}

export function adminViewPath(view: AdminDashboardView): string {
  return view === "staff" ? "/admin/staff/calendar" : `/admin/${view}`;
}

export function adminStaffTabPath(tab: AdminStaffTab): string {
  return `/admin/staff/${tab}`;
}
