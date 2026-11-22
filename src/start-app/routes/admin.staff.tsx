import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminStaffTabs } from "@/components/admin/AdminStaffBookingsView";
import { StartAdminNotFound, StartAdminViewError } from "../admin/AdminBoundaries";

// The tab strip lives here, not in each $tab page, so it stays mounted (and focused) across tabs.
export const Route = createFileRoute("/admin/staff")({
  component: StartAdminStaffLayoutRoute,
  errorComponent: StartAdminViewError,
  notFoundComponent: StartAdminNotFound,
});

function StartAdminStaffLayoutRoute() {
  return (
    <AdminStaffTabs>
      <Outlet />
    </AdminStaffTabs>
  );
}
