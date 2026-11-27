import { createFileRoute } from "@tanstack/react-router";
import { StockBalancesView } from "@/components/stock/StockBalancesView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/balances")({
  component: StockBalancesView,
  errorComponent: StartAdminViewError,
});
