"use client";

import { MessageCircle } from "lucide-react";
import { useLocale } from "next-intl";
import { localizeHref } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function MessagingButtons({
  whatsappNumber,
  lineId,
  quiet = false,
}: {
  whatsappNumber: string;
  lineId?: string;
  quiet?: boolean;
}) {
  const locale = useLocale();
  const cleanNumber = whatsappNumber.replace(/[^\d]/g, "");
  const linkClassName = quiet
    ? "inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-slate-700 transition hover:border-gold/40 hover:bg-gold/10 hover:text-navy dark:text-slate-200 dark:hover:text-gold"
    : "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white transition";

  return (
    <div className={cn("grid grid-cols-2 gap-2", quiet && "opacity-90")}>
      <a
        href={`https://wa.me/${cleanNumber}`}
        target="_blank"
        rel="noreferrer"
        className={cn(linkClassName, !quiet && "bg-emerald-600 hover:bg-emerald-500")}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp
      </a>
      <a
        href={lineId ? `https://line.me/R/ti/p/${encodeURIComponent(lineId)}` : localizeHref("/#contact", locale)}
        target={lineId ? "_blank" : undefined}
        rel={lineId ? "noreferrer" : undefined}
        className={cn(linkClassName, !quiet && "bg-lime-600 hover:bg-lime-500")}
      >
        LINE
      </a>
    </div>
  );
}
