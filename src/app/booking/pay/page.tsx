import { Suspense } from "react";
import { PayClient } from "@/components/booking/PayClient";

export default function PayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">Loading payment...</div>}>
      <PayClient />
    </Suspense>
  );
}
