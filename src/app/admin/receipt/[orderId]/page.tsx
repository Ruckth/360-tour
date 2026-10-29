"use client";

import { useParams, useRouter } from "next/navigation";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { orderPath } from "@/components/checkout/checkout-source";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";

export default function AdminReceiptPage() {
  const router = useRouter();
  const { orderId } = useParams<{ orderId: string }>();
  return (
    <CheckoutBackendProvider backend={convexCheckoutBackend}>
      <ReceiptView
        orderId={orderId as OrderId}
        onNewSale={() => router.push("/admin/checkout")}
        onOpenOrder={(id) => router.push(orderPath(id))}
      />
    </CheckoutBackendProvider>
  );
}
