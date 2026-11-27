import { createFileRoute } from "@tanstack/react-router";
import { StockProductsView } from "@/components/stock/StockProductsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/products")({
  component: StockProductsView,
  errorComponent: StartAdminViewError,
});
