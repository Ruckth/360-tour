import { createFileRoute, notFound } from "@tanstack/react-router";
import { StartAdminNotFound } from "../admin/AdminBoundaries";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/$")({
  beforeLoad: ({ location }) => {
    const target = resolveAdminRedirect(location.pathname);
    if (target) {
      throw createAdminRedirect(target);
    }
    throw notFound();
  },
  component: () => null,
  notFoundComponent: StartAdminNotFound,
});
