import { createFileRoute } from "@tanstack/react-router";
import { MarketingCouponScreen } from "@/components/admin/marketing/MarketingScreens";
import { StartAdminViewError } from "../admin/AdminBoundaries";

/** `/admin/marketing/coupons/new` opens the builder; any other id opens that coupon. */
export const Route = createFileRoute("/admin/marketing/coupons/$id")({
  component: StartAdminMarketingCouponRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingCouponRoute() {
  const { id } = Route.useParams();
  return <MarketingCouponScreen couponId={id} />;
}
