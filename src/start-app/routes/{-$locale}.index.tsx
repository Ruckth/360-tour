import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { HomeView } from "@/components/home/HomeView";
import { HomeLoading } from "@/components/loading/RouteLoading";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { guestLocaleContext, loadStartHomeData, validateGuestLocaleInput } from "../guest/guest-route";

export const loadStartHomeServerFn = createServerFn({ method: "GET" })
  .validator(validateGuestLocaleInput)
  .handler(async ({ data }) => {
    // Dynamic imports keep Convex reads and response helpers on the server.
    const [villas, { getRequest, setResponseHeader, setResponseStatus }] = await Promise.all([
      import("../villas.server"),
      import("@tanstack/react-start/server"),
    ]);
    return loadStartHomeData(data.locale, {
      getCatalog: villas.getStartVillaCatalog,
      getFeaturedReviews: () => villas.getStartFeaturedReviews(getRequest()),
      isVillaUnavailableError: (error): error is InstanceType<typeof villas.VillaUnavailableError> =>
        error instanceof villas.VillaUnavailableError,
      setResponseHeader,
      setResponseStatus,
    });
  });

export const Route = createFileRoute("/{-$locale}/")({
  beforeLoad: guestLocaleContext,
  loader: async ({ context }) => {
    const result = await loadStartHomeServerFn({ data: { locale: context.guestLocale } });
    // The root error boundary renders the retry page; the server already set 503/500.
    if (result.status !== "ok") throw new Error("Villa catalog unavailable.");
    return result.data;
  },
  pendingComponent: HomeLoading,
  component: StartHome,
});

function StartHome() {
  const { villas, reviews } = Route.useLoaderData();
  const { guestLocale } = Route.useRouteContext();
  return <HomeView locale={guestLocale} messages={usePublicMessages()} villas={villas} reviews={reviews} />;
}
