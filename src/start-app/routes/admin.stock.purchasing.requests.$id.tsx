import { createFileRoute } from "@tanstack/react-router";
import { PurchaseRequestDetailView } from "@/components/stock/PurchaseRequestDetailView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/purchasing/requests/$id")({
  component: StartAdminStockRequestRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminStockRequestRoute() {
  const { id } = Route.useParams();
  return <PurchaseRequestDetailView requestId={id} />;
}
