import { createFileRoute } from "@tanstack/react-router";
import AdminCheckoutPage from "@/components/checkout/AdminCheckoutPage";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/checkout/")({
  component: StartAdminCheckoutRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminCheckoutRoute() {
  return <AdminCheckoutPage />;
}
