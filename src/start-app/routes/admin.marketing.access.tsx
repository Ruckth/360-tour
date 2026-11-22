import { createFileRoute, Navigate } from "@tanstack/react-router";
import { resolveMarketingAccessRedirect } from "../admin/admin-route";

// Render only after the parent staff and Marketing access gates allow this outlet.
export const Route = createFileRoute("/admin/marketing/access")({
  component: () => <Navigate {...resolveMarketingAccessRedirect()} />,
});
