import { createFileRoute } from "@tanstack/react-router";
import { MarketingCampaignsScreen } from "@/components/admin/marketing/MarketingScreens";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/marketing/campaigns")({
  component: StartAdminMarketingCampaignsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingCampaignsRoute() {
  return <MarketingCampaignsScreen />;
}
