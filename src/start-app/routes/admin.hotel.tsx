import { canOpenResortDesk } from "@/components/admin/admin-access";
import { useStaffAccess } from "@/components/admin/staff-access";
import { createFileRoute } from "@tanstack/react-router";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/hotel")({
  component: StartAdminHotelRoute,
  errorComponent: StartAdminViewError,
});

export function StartAdminHotelRoute() {
  const access = useStaffAccess();
  if (!canOpenResortDesk(access, "bookings")) {
    return <p role="status" className="p-6 text-sm text-muted-foreground">You don’t have access to this resort desk.</p>;
  }
  return <AdminBookingsView />;
}
