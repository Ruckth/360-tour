import type { ComponentProps } from "react";
import { localizeHref } from "@/i18n/routing";
import { useLocale } from "@/platform/intl";
import PlatformLink from "@/platform/link";

export function Link({ href, locale, ...props }: ComponentProps<typeof PlatformLink> & { locale?: string }) {
  const activeLocale = useLocale();
  return <PlatformLink {...props} href={localizeHref(href, locale ?? activeLocale)} />;
}
