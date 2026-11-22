import { createFileRoute } from "@tanstack/react-router";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    const target = resolveAdminRedirect("/admin");
    if (target) {
      throw createAdminRedirect(target);
    }
  },
  component: () => null,
});
