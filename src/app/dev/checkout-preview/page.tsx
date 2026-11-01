import { notFound } from "next/navigation";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";

/** Dev-only visual QA for the checkout on sample data. Not linked anywhere; 404 outside `next dev`. */
export default function CheckoutPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CheckoutPreview />;
}
