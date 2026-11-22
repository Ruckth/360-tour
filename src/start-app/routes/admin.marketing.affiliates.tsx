import { createFileRoute } from "@tanstack/react-router";
import { AffiliatesScreen } from "@/components/admin/marketing/AffiliatesScreen";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/marketing/affiliates")({
  component: StartAdminMarketingAffiliatesRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingAffiliatesRoute() {
  return <AffiliatesScreen />;
}
