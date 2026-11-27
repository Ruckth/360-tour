import { createFileRoute } from "@tanstack/react-router";
import { StockActivityView } from "@/components/stock/StockActivityView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/activity")({
  component: StockActivityView,
  errorComponent: StartAdminViewError,
});
