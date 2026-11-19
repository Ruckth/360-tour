import { notFound } from "next/navigation";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";
import { designFixturesEnabled } from "@/lib/design-fixtures";

/**
 * The checkout and its receipt inside the admin shell (staff sign-in still applies), on sample data.
 * Lets UI review cover checkout and every commerce state where the shared backend can't serve it.
 * Renders in `next dev` and on Vercel Preview; 404 in production.
 */
export default function AdminCheckoutPreviewPage() {
  if (!designFixturesEnabled()) notFound();
  return <CheckoutPreview embedded />;
}
