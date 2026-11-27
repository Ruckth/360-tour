import { createFileRoute } from "@tanstack/react-router";
import { SupplierReceiptDetailView } from "@/components/stock/SupplierReceiptDetailView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/stock/purchasing/receipts/$id")({
  component: StartAdminStockReceiptRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminStockReceiptRoute() {
  const { id } = Route.useParams();
  return <SupplierReceiptDetailView receiptId={id} />;
}
