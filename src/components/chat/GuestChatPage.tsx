import { AIChatPage } from "@/components/chat/AIChatWidget";
import { resort } from "@/lib/data/resort-config";

export type ChatPageService = { slug: string; name: string; durationMin?: number };
export type ChatPageProperty = { id: string; name: string };

/**
 * `/chat` contents shared by the Next page and the Start route; `?service=` pre-fills a draft, and
 * `&duration=90` names the length in it ("Thai massage (90 min)").
 */
export function GuestChatPage({
  service,
  property,
  draftTemplate,
  minutesLabel,
}: {
  service: ChatPageService | null;
  property: ChatPageProperty | null;
  draftTemplate: string;
  minutesLabel: string;
}) {
  const name = service?.durationMin ? `${service.name} (${service.durationMin} ${minutesLabel})` : service?.name;
  return (
    <AIChatPage
      key={service ? `${service.slug}${service.durationMin ? `:${service.durationMin}` : ""}` : "default"}
      initialDraft={name ? draftTemplate.replace("{name}", name) : undefined}
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
