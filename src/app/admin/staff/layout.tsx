import type { ReactNode } from "react";
import { AdminStaffTabs } from "@/components/admin/AdminStaffBookingsView";

// The tab strip lives here, not in each [tab] page, so it stays mounted (and focused) across tabs.
export default function AdminStaffLayout({ children }: { children: ReactNode }) {
  return <AdminStaffTabs>{children}</AdminStaffTabs>;
}
