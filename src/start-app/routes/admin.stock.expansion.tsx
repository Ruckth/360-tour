import { createFileRoute } from "@tanstack/react-router";
import { StockExpansionView } from "@/components/stock/StockExpansionView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/expansion")({
  component: StockExpansionView,
  errorComponent: StartAdminViewError,
});
