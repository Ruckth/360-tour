import { AIChatPage } from "@/components/chat/AIChatWidget";
import { resort } from "@/lib/data/resort-config";

export type ChatPageService = { slug: string; name: string };
export type ChatPageProperty = { id: string; name: string };

/** `/chat` contents shared by the Next page and the Start route; `?service=` pre-fills a draft. */
export function GuestChatPage({
  service,
  property,
  draftTemplate,
}: {
  service: ChatPageService | null;
  property: ChatPageProperty | null;
  draftTemplate: string;
}) {
  return (
    <AIChatPage
      key={service?.slug ?? "default"}
      initialDraft={service ? draftTemplate.replace("{name}", service.name) : undefined}
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
