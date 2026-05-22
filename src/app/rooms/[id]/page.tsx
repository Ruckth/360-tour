import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { RoomDetailClient } from "@/components/rooms/RoomDetailClient";
import { properties } from "@/lib/data/properties";
import { Suspense } from "react";
import { localizeHref } from "@/i18n/routing";
import {
  getLocalizedPropertyById,
  getLocalizedResort,
  getPublicMessages,
} from "@/lib/i18n/public-content";

export function generateStaticParams() {
  return properties.map((property) => ({ id: property.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const property = getLocalizedPropertyById(id, locale);
  const resort = getLocalizedResort(locale);
  const seo = getPublicMessages(locale).SEO;
  return {
    title: `${property?.name ?? seo.villaFallback} — ${resort.name}`,
    description: property?.description ?? resort.description,
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
  const property = getLocalizedPropertyById(id, locale);

  if (!property) {
    return (
      <div className="flex min-h-screen items-center justify-center pt-16">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">{t("propertyNotFound")}</h1>
          <Link href={localizeHref("/", locale)} className="mt-4 inline-block text-primary hover:underline">
            {t("backHome")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">{t("loadingVilla")}</div>}>
      <RoomDetailClient property={property} />
    </Suspense>
  );
}
