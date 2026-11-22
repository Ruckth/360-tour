import { createFileRoute, notFound } from "@tanstack/react-router";
import { AdminStaffBookingsView } from "@/components/admin/AdminStaffBookingsView";
import { isAdminStaffTab } from "@/components/admin/admin-routes";
import { StartAdminNotFound, StartAdminViewError } from "../admin/AdminBoundaries";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/staff/$tab")({
  beforeLoad: ({ params }) => {
    if (!isAdminStaffTab(params.tab)) {
      const target = resolveAdminRedirect(`/admin/staff/${params.tab}`);
      if (target) {
        throw createAdminRedirect(target);
      }
      throw notFound();
    }
    return { tab: params.tab };
  },
  component: StartAdminStaffTabRoute,
  errorComponent: StartAdminViewError,
  notFoundComponent: StartAdminNotFound,
});

function StartAdminStaffTabRoute() {
  const { tab } = Route.useRouteContext();
  return <AdminStaffBookingsView tab={tab} />;
}
