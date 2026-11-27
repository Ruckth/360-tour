import { createFileRoute, Outlet } from "@tanstack/react-router";
import { StockSectionShell } from "@/components/stock/StockSectionNav";
import { StartAdminNotFound, StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock")({
  component: StartAdminStockLayoutRoute,
  errorComponent: StartAdminViewError,
  notFoundComponent: StartAdminNotFound,
});

function StartAdminStockLayoutRoute() {
  return (
    <StockSectionShell>
      <Outlet />
    </StockSectionShell>
  );
}
