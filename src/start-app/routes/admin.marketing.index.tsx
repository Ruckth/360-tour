import { createFileRoute } from "@tanstack/react-router";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/marketing/")({
  beforeLoad: () => {
    const target = resolveAdminRedirect("/admin/marketing");
    if (target) {
      throw createAdminRedirect(target);
    }
  },
  component: () => null,
});
