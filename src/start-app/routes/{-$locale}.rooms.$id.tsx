import {
  createFileRoute,
  notFound,
  redirect,
  useRouter,
  type ErrorComponentProps,
  type NotFoundRouteProps,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Suspense } from "react";
import { RoomDetailClient } from "@/components/rooms/RoomDetailClient";
import { globalNotFound, isRouteNotFound, NOINDEX_META } from "../not-found";
import { StartRoomError, StartRoomNotFound } from "../guest/StartRoomBoundaries";
import {
  buildRoomHead,
  buildRoomHeaders,
  loadStartRoomData,
  resolveRoomLocale,
  StartRoomLoadError,
  StartRoomUnavailableError,
  validateRoomInput,
  validateRoomSearch,
  type StartRoomServerResult,
} from "../guest/room-route";

export const loadStartRoomServerFn = createServerFn({ method: "GET" })
  .validator(validateRoomInput)
  .handler(async ({ data }): Promise<StartRoomServerResult> => {
    // Dynamic imports keep server-only Convex reads, response helpers and the all-locale
    // dictionary loader inside the server boundary and out of browser bundles.
    const [
      { getStartVilla, villaCacheScope, villaCacheHeader, VillaUnavailableError },
      { getLocalizedResort, getPublicMessages },
      { siteUrl },
      { getRequest, setResponseHeader, setResponseStatus },
    ] = await Promise.all([
      import("../villas.server"),
      import("@/lib/i18n/server-content"),
      import("@/lib/site-url"),
      import("@tanstack/react-start/server"),
    ]);

    return loadStartRoomData(data, {
      getStartVilla,
      villaCacheHeader,
      hasSharedVillaCache: () => villaCacheScope() === "shared",
      isVillaUnavailableError: (error): error is InstanceType<typeof VillaUnavailableError> =>
        error instanceof VillaUnavailableError,
      getLocalizedResort,
      getPublicMessages,
      siteUrl,
      getRequest,
      getTourModulePreloads: async () => (await import("../guest/tour-preloads.server")).tourModulePreloads,
      setResponseHeader,
      setResponseStatus,
      env: process.env,
    });
  });

export const Route = createFileRoute("/{-$locale}/rooms/$id")({
  validateSearch: validateRoomSearch,
  beforeLoad: ({ params, search }) => {
    const resolution = resolveRoomLocale(params.locale);
    if (resolution.kind === "redirect") {
      throw redirect({
        to: "/{-$locale}/rooms/$id",
        params: { locale: undefined, id: params.id },
        search,
        statusCode: 308,
      });
    }
    if (resolution.kind === "invalid") {
      // An unknown prefix is an unmatched URL: the global 404, not "Property not found".
      throw globalNotFound();
    }
    return { roomLocale: resolution.locale };
  },
  loader: async ({ params, context }) => {
    const result = await loadStartRoomServerFn({
      data: { slug: params.id, locale: context.roomLocale },
    });
    if (result.status === "not_found") {
      throw notFound({ data: result.notFound });
    }
    if (result.status === "unavailable") {
      throw new StartRoomUnavailableError(result);
    }
    if (result.status === "error") {
      throw new StartRoomLoadError(result);
    }
    return result.data;
  },
  // A missing villa keeps the root's localized title and is never indexed.
  head: ({ loaderData, match }) => (isRouteNotFound(match) ? { meta: [NOINDEX_META] } : buildRoomHead(loaderData, match?.search)),
  headers: ({ loaderData }) => buildRoomHeaders(loaderData),
  component: StartRoomRouteComponent,
  notFoundComponent: StartRoomRouteNotFound,
  errorComponent: StartRoomRouteError,
});

function StartRoomRouteComponent() {
  const data = Route.useLoaderData();
  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">{data.loadingLabel}</div>}>
      <RoomDetailClient property={data.villa} reviews={data.reviews} />
    </Suspense>
  );
}

function StartRoomRouteNotFound({ data }: NotFoundRouteProps) {
  return <StartRoomNotFound data={data} />;
}

function StartRoomRouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <StartRoomError
      error={error}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}
