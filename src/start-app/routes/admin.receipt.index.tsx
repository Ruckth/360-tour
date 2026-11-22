import { createFileRoute } from "@tanstack/react-router";
import { createAdminRedirect, resolveAdminRedirect } from "../admin/admin-route";

export const Route = createFileRoute("/admin/receipt/")({
  beforeLoad: () => {
    const target = resolveAdminRedirect("/admin/receipt");
    if (target) {
      throw createAdminRedirect(target);
    }
  },
  component: () => null,
});
