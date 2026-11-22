import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RoomDetailClient } from "@/components/rooms/RoomDetailClient";
import { getLocalizedResort } from "@/lib/i18n/server-content";
import type { getVilla } from "@/lib/server/villas";

export async function loadRoomMetadata(id: string, read: typeof getVilla) {
  const locale = await getLocale();
  const villa = (await read(id, locale))?.villa;
  // Before anything streams, so unknown villas get a real HTTP 404 rather than a 200 "not found" page.
  if (!villa) notFound();
  const resort = getLocalizedResort(locale);
  return {
    title: `${villa.name} — ${resort.name}`,
    description: villa.description || resort.description,
    openGraph: villa.images[0] ? { images: [villa.images[0]] } : undefined,
  };
}

export async function renderRoom(id: string, read: typeof getVilla) {
  const locale = await getLocale();
  const t = await getTranslations("Villa");
  const result = await read(id, locale);
  if (!result) notFound();

  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">{t("loadingVilla")}</div>}>
      <RoomDetailClient property={result.villa} reviews={result.reviews} />
    </Suspense>
  );
}
