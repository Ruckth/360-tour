import { createFileRoute } from "@tanstack/react-router";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/hotel")({
  component: StartAdminHotelRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminHotelRoute() {
  return <AdminBookingsView />;
}
