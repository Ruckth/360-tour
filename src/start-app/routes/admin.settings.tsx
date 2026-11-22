import { createFileRoute } from "@tanstack/react-router";
import { AdminSettingsView } from "@/components/admin/AdminSettingsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";
import { validateAdminSettingsSearch } from "../admin/admin-route";

export const Route = createFileRoute("/admin/settings")({
  validateSearch: validateAdminSettingsSearch,
  component: StartAdminSettingsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminSettingsRoute() {
  return <AdminSettingsView />;
}
