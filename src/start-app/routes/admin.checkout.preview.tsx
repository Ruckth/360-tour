import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";
import { StartAdminNotFound, StartAdminViewError } from "../admin/AdminBoundaries";

export const loadStartCheckoutPreviewServerFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ enabled: boolean }> => {
    const [{ resolveStartCheckoutPreviewAccess }, { getRequest, setResponseStatus }] = await Promise.all([
      import("../admin/admin-layout.server"),
      import("@tanstack/react-start/server"),
    ]);
    return resolveStartCheckoutPreviewAccess({
      getRequest,
      setResponseStatus,
      env: process.env,
    });
  });

/**
 * The checkout and its receipt inside the admin shell (staff sign-in still applies), on sample data.
 * Renders in development and on Vercel Preview; answers 404 in production.
 */
export const Route = createFileRoute("/admin/checkout/preview")({
  loader: async () => {
    const result = await loadStartCheckoutPreviewServerFn();
    if (!result.enabled) {
      throw notFound();
    }
    return result;
  },
  component: StartAdminCheckoutPreviewRoute,
  errorComponent: StartAdminViewError,
  notFoundComponent: StartAdminNotFound,
});

function StartAdminCheckoutPreviewRoute() {
  return <CheckoutPreview embedded />;
}
