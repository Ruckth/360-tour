import { notFound } from "next/navigation";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";

/**
 * Dev-only: the checkout and its receipt inside the admin shell, on sample data. Lets UI review
 * screenshots cover checkout when the shared dev backend can't serve it. 404 outside `next dev`.
 */
export default function AdminCheckoutPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CheckoutPreview embedded />;
}
