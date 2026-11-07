import { MarketingCouponScreen } from "@/components/admin/marketing/MarketingScreens";

/** `/admin/marketing/coupons/new` opens the builder; any other id opens that coupon. */
export default async function AdminMarketingCouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketingCouponScreen couponId={id} />;
}
