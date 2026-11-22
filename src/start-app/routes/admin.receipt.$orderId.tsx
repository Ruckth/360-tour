import { createFileRoute } from "@tanstack/react-router";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { orderPath } from "@/components/checkout/checkout-source";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { useCheckoutTiming } from "@/components/checkout/timing-gate";
import { useRouter } from "@/platform/navigation";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/receipt/$orderId")({
  component: StartAdminReceiptRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminReceiptRoute() {
  const router = useRouter();
  const { orderId } = Route.useParams();
  const timing = useCheckoutTiming(convexCheckoutBackend);
  return (
    <CheckoutBackendProvider backend={timing.backend}>
      <ReceiptView
        orderId={orderId as OrderId}
        onNewSale={() => router.push("/admin/checkout")}
        onOpenOrder={(id) => router.push(orderPath(id))}
      />
      {timing.readout}
    </CheckoutBackendProvider>
  );
}
