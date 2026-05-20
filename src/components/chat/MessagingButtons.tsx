"use client";

import { MessageCircle } from "lucide-react";
import { useLocale } from "next-intl";
import { localizeHref } from "@/i18n/routing";

export function MessagingButtons({
  whatsappNumber,
  lineId,
}: {
  whatsappNumber: string;
  lineId?: string;
}) {
  const locale = useLocale();
  const cleanNumber = whatsappNumber.replace(/[^\d]/g, "");

  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={`https://wa.me/${cleanNumber}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp
      </a>
      <a
        href={lineId ? `https://line.me/R/ti/p/${encodeURIComponent(lineId)}` : localizeHref("/#contact", locale)}
        target={lineId ? "_blank" : undefined}
        rel={lineId ? "noreferrer" : undefined}
        className="inline-flex items-center justify-center rounded-lg bg-lime-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-lime-500"
      >
        LINE
      </a>
    </div>
  );
}
