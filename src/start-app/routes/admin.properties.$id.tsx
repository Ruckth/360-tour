import { createFileRoute } from "@tanstack/react-router";
import { AdminPropertyEditor } from "@/components/admin/AdminPropertyEditor";
import { StartAdminViewError } from "../admin/AdminBoundaries";
import { validateAdminPropertySearch } from "../admin/admin-route";

export const Route = createFileRoute("/admin/properties/$id")({
  validateSearch: validateAdminPropertySearch,
  component: StartAdminPropertyRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminPropertyRoute() {
  const { id } = Route.useParams();
  return <AdminPropertyEditor propertyId={id} />;
}
