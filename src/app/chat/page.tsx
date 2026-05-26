import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { AIChatPage } from "@/components/chat/AIChatWidget";
import { getLocalizedPropertyById, getPublicMessages } from "@/lib/i18n/public-content";
import { resort } from "@/lib/data/resort-config";

type ChatSearchParams = Record<string, string | string[] | undefined>;

function getParam(params: ChatSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

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
  searchParams: Promise<ChatSearchParams>;
}) {
  const locale = await getLocale();
  const params = await searchParams;
  const propertyId = getParam(params, "property");
  const property = propertyId ? getLocalizedPropertyById(propertyId, locale) : undefined;

  return (
    <AIChatPage
      propertySlug={property?.id}
      propertyName={property?.name}
      contactEmail={resort.contactEmail}
      whatsappNumber={resort.whatsapp}
      lineId={resort.lineId}
      lineUrl={resort.lineUrl}
      lineQrImage={resort.lineQrImage}
    />
  );
}
