import { createFileRoute } from "@tanstack/react-router";
import { AdminPropertyEditor } from "@/components/admin/AdminPropertyEditor";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/properties/$id")({
  component: StartAdminPropertyRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminPropertyRoute() {
  const { id } = Route.useParams();
  return <AdminPropertyEditor propertyId={id} />;
}
