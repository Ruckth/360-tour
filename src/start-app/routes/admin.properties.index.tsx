import { createFileRoute } from "@tanstack/react-router";
import { AdminPropertiesView } from "@/components/admin/AdminPropertiesView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/properties/")({
  component: StartAdminPropertiesRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminPropertiesRoute() {
  return <AdminPropertiesView />;
}
