import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { localizeHref } from "@/i18n/routing";

export default async function VillaNotFound() {
  const locale = await getLocale();
  const t = await getTranslations("Villa");

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
