import { createFileRoute } from "@tanstack/react-router";
import { validatePurchasingSearch } from "@/components/stock/purchasing-location";
import { StockPurchasingHubView } from "@/components/stock/StockPurchasingHubView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/purchasing/")({
  validateSearch: validatePurchasingSearch,
  component: StockPurchasingHubView,
  errorComponent: StartAdminViewError,
});
