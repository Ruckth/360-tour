import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MarketingAccessGate } from "@/components/admin/marketing/MarketingAccess";
import { MarketingSectionNav } from "@/components/admin/marketing/MarketingSectionNav";
import { StartAdminNotFound, StartAdminViewError } from "../admin/AdminBoundaries";

// `/admin/marketing` itself redirects to the dashboard (see adminRedirectPath).
export const Route = createFileRoute("/admin/marketing")({
  component: StartAdminMarketingLayoutRoute,
  errorComponent: StartAdminViewError,
  notFoundComponent: StartAdminNotFound,
});

function StartAdminMarketingLayoutRoute() {
  return (
    <MarketingAccessGate>
      <MarketingSectionNav>
        <Outlet />
      </MarketingSectionNav>
    </MarketingAccessGate>
  );
}
