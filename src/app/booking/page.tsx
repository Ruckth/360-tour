import { BookingFunnel } from "@/components/booking/BookingFunnel";
import { Suspense } from "react";

export const metadata = {
  title: "Book Direct — Seaview Residence",
};

export default function BookingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">Loading booking...</div>}>
      <BookingFunnel />
    </Suspense>
  );
}
