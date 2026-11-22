import { createFileRoute } from "@tanstack/react-router";
import { DashboardScreen } from "@/components/admin/marketing/dashboard/DashboardScreen";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/marketing/dashboard")({
  component: StartAdminMarketingDashboardRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingDashboardRoute() {
  return <DashboardScreen />;
}
