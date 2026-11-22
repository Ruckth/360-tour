import { getPublicService } from "@/lib/server/services";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { GuestChatPage } from "@/components/chat/GuestChatPage";
import { firstParam, type PageSearch } from "@/lib/page-search";
import { getPublicMessages } from "@/lib/i18n/server-content";
import { getVilla } from "@/lib/server/villas";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const messages = getPublicMessages(locale);

  return {
    title: `${messages.Chat.defaultTitle} - ${messages.Resort.location}`,
  };
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  const locale = await getLocale();
  const params = await searchParams;
  const propertyId = firstParam(params, "property");
  const serviceSlug = firstParam(params, "service");
  const service = serviceSlug ? await getPublicService(serviceSlug) : null;
  const property = propertyId
    ? (await getVilla(propertyId, locale).catch(() => null))?.villa ?? null
    : null;

  return (
    <GuestChatPage
      service={service}
      property={property}
      draftTemplate={getPublicMessages(locale).ServiceCatalog.draft}
    />
  );
}
