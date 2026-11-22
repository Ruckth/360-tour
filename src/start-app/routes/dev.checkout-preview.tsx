import { createFileRoute, notFound } from "@tanstack/react-router";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";

export const Route = createFileRoute("/dev/checkout-preview")({
  beforeLoad: () => { if (!import.meta.env.DEV) throw notFound(); },
  component: CheckoutPreview,
});
