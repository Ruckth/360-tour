import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ServicesView } from "@/components/services/ServicesView";
import { servicesQuery } from "@/lib/services-query";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { guestHead, guestLocaleContext, guestSearch, validateServicesInput } from "../guest/guest-route";

export const loadStartServicesServerFn = createServerFn({ method: "GET" })
  .validator(validateServicesInput)
  .handler(async ({ data }) => {
    // Each read resolves to null on failure or timeout; the view shows the unavailable state.
    const { getServiceCatalog } = await import("@/lib/server/services");
    const [directory, result] = await getServiceCatalog(data);
    return { directory, result };
  });

export const Route = createFileRoute("/{-$locale}/services")({
  validateSearch: guestSearch,
  beforeLoad: guestLocaleContext,
  loaderDeps: ({ search }) => servicesQuery(search),
  loader: ({ deps }) => loadStartServicesServerFn({ data: deps }),
  head: ({ matches }) => guestHead(matches, (messages) => ({
    title: messages.ServiceCatalog.title,
    description: messages.ServiceCatalog.intro,
  })),
  component: StartServices,
});

function StartServices() {
  const { directory, result } = Route.useLoaderData();
  const { guestLocale } = Route.useRouteContext();
  return (
    <ServicesView
      locale={guestLocale}
      t={usePublicMessages().ServiceCatalog}
      query={Route.useLoaderDeps()}
      directory={directory}
      result={result}
    />
  );
}
