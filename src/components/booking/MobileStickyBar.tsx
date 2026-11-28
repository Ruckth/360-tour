"use client";

import Link from "@/platform/link";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "@/platform/intl";
import { usePathname, useSearchParams } from "@/platform/navigation";
import { localizeHref } from "@/i18n/routing";
import { buildChatHref } from "@/lib/chat/navigation";
import { registerGuestBottomControl } from "@/lib/guest-bottom-inset";

export function MobileStickyBar({
  propertyId,
}: {
  propertyId: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("Nav");
  const chatT = useTranslations("Chat");
  const chatHref = buildChatHref({
    locale,
    pathname,
    propertySlug: propertyId,
    search: searchParams,
  });

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    return registerGuestBottomControl("mobile-sticky-bar", el, { fallbackPx: 88 });
  }, []);

  return (
    <div
      ref={barRef}
      className="fixed inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-40 md:hidden"
    >
      <div className="mx-auto flex max-w-sm translate-y-1 items-center gap-2 rounded-full border border-border/80 bg-background/90 p-2 shadow-2xl shadow-black/25 backdrop-blur-xl transition-transform duration-300 focus-within:translate-y-0 hover:translate-y-0 dark:bg-card/90">
        <Link
          href={localizeHref(`/booking?unit=${propertyId}`, locale)}
          className="flex h-12 flex-1 items-center justify-center rounded-full bg-gold px-5 text-sm font-semibold text-navy shadow-lg shadow-gold/20 transition hover:bg-gold-light"
        >
          {t("book")}
        </Link>
        <Link
          href={chatHref}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={chatT("open")}
        >
          <MessageCircle className="h-5 w-5" />
        </Link>
      </div>
    </div>
  );
}
