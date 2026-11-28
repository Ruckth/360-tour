import { createFileRoute } from "@tanstack/react-router";
import { AdminTodayView } from "@/components/admin/AdminTodayView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/today")({
  component: StartAdminTodayRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminTodayRoute() {
  return <AdminTodayView />;
}
