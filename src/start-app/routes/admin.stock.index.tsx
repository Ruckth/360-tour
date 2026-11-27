import { createFileRoute } from "@tanstack/react-router";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/stock/")({
  beforeLoad: () => {
    const target = resolveAdminRedirect("/admin/stock");
    if (target) {
      throw createAdminRedirect(target);
    }
  },
  component: () => null,
});
