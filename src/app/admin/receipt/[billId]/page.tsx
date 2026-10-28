"use client";

import { useParams, useRouter } from "next/navigation";
import { CheckoutBackendProvider, type BillId } from "@/components/checkout/backend";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";

export default function AdminReceiptPage() {
  const router = useRouter();
  const { billId } = useParams<{ billId: string }>();
  return (
    <CheckoutBackendProvider backend={convexCheckoutBackend}>
      <ReceiptView
        billId={billId as BillId}
        onNewSale={() => router.push("/admin/checkout")}
        onOpenBill={(id) => router.push(`/admin/checkout?bill=${id}`)}
      />
    </CheckoutBackendProvider>
  );
}
