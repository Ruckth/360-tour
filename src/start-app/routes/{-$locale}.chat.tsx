import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { GuestChatPage } from "@/components/chat/GuestChatPage";
import { ChatLoading } from "@/components/loading/RouteLoading";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import {
  chatQuery,
  guestHead,
  guestLocaleContext,
  guestSearch,
  loadStartChatData,
  validateChatInput,
} from "../guest/guest-route";

export const loadStartChatServerFn = createServerFn({ method: "GET" })
  .validator(validateChatInput)
  .handler(async ({ data }) => {
    const [{ getPublicService }, { getStartVilla }] = await Promise.all([
      import("@/lib/server/services"),
      import("../villas.server"),
    ]);
    return loadStartChatData(data, { getPublicService, getVilla: getStartVilla });
  });

export const Route = createFileRoute("/{-$locale}/chat")({
  validateSearch: guestSearch,
  beforeLoad: guestLocaleContext,
  loaderDeps: ({ search }) => chatQuery(search),
  loader: ({ context, deps }) => loadStartChatServerFn({ data: { locale: context.guestLocale, ...deps } }),
  head: ({ matches }) => guestHead(matches, (messages) => ({
    title: `${messages.Chat.defaultTitle} - ${messages.Resort.location}`,
  })),
  pendingComponent: ChatLoading,
  component: StartChat,
});

function StartChat() {
  const { service, property } = Route.useLoaderData();
  const draftTemplate = usePublicMessages().ServiceCatalog.draft;
  return <GuestChatPage service={service} property={property} draftTemplate={draftTemplate} />;
}
