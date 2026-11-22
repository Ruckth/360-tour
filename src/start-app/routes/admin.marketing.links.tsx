import { createFileRoute } from "@tanstack/react-router";
import { MarketingLinksScreen } from "@/components/admin/marketing/MarketingScreens";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/marketing/links")({
  component: StartAdminMarketingLinksRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingLinksRoute() {
  return <MarketingLinksScreen />;
}
