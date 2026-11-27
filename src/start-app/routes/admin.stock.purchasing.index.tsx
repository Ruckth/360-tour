import { createFileRoute } from "@tanstack/react-router";
import { StockPurchasingHubView } from "@/components/stock/StockPurchasingHubView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/purchasing/")({
  component: StockPurchasingHubView,
  errorComponent: StartAdminViewError,
});
