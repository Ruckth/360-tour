"use client";

import { useParams, useRouter } from "next/navigation";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { orderPath } from "@/components/checkout/checkout-source";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { useCheckoutTiming } from "@/components/checkout/timing-gate";
import { ReceiptView } from "@/components/checkout/ReceiptView";

export default function AdminReceiptPage() {
  const router = useRouter();
  const { orderId } = useParams<{ orderId: string }>();
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
