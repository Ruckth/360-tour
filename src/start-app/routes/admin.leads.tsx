import { createFileRoute } from "@tanstack/react-router";
import { AdminLeadsView } from "@/components/admin/AdminLeadsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/leads")({
  component: StartAdminLeadsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminLeadsRoute() {
  return <AdminLeadsView />;
}
