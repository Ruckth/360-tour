import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RoomDetailClient } from "@/components/rooms/RoomDetailClient";
import { defaultLocale } from "@/i18n/routing";
import { getLocalizedResort } from "@/lib/i18n/server-content";
import { getVilla, getVillaCatalog } from "@/lib/server/villas";

export async function generateStaticParams() {
  const { villas } = await getVillaCatalog(defaultLocale);
  return villas.map((villa) => ({ id: villa.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const villa = (await getVilla(id, locale))?.villa;
  // Before anything streams, so unknown villas get a real HTTP 404 rather than a 200 "not found" page.
  if (!villa) notFound();
  const resort = getLocalizedResort(locale);
  return {
    title: `${villa.name} — ${resort.name}`,
    description: villa.description || resort.description,
    openGraph: villa.images[0] ? { images: [villa.images[0]] } : undefined,
  };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations("Villa");
  const result = await getVilla(id, locale);
  if (!result) notFound();

  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">{t("loadingVilla")}</div>}>
      <RoomDetailClient property={result.villa} reviews={result.reviews} />
    </Suspense>
  );
}
