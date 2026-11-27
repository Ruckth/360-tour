import { createFileRoute } from "@tanstack/react-router";
import { PurchaseOrderDetailView } from "@/components/stock/PurchaseOrderDetailView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/purchasing/orders/$id")({
  component: StartAdminStockOrderRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminStockOrderRoute() {
  const { id } = Route.useParams();
  return <PurchaseOrderDetailView orderId={id} />;
}
