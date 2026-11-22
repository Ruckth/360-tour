import { createFileRoute } from "@tanstack/react-router";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/staff/")({
  beforeLoad: () => {
    const target = resolveAdminRedirect("/admin/staff");
    if (target) {
      throw createAdminRedirect(target);
    }
  },
  component: () => null,
});
