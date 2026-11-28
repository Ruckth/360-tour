import { canOpenResortDesk } from "@/components/admin/admin-access";
import { useStaffAccess } from "@/components/admin/staff-access";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";

export function StartAdminHotelRoute() {
  const access = useStaffAccess();
  if (!canOpenResortDesk(access, "bookings")) {
    return <p role="status" className="p-6 text-sm text-muted-foreground">You don’t have access to this resort desk.</p>;
  }
  return <AdminBookingsView />;
}
