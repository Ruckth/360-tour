import { createFileRoute } from "@tanstack/react-router";
import { MarketingCouponsScreen } from "@/components/admin/marketing/MarketingScreens";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/marketing/coupons/")({
  component: StartAdminMarketingCouponsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingCouponsRoute() {
  return <MarketingCouponsScreen />;
}
