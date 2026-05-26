"use client";

import Image from "next/image";
import { Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ContactAppBrandIcon } from "@/components/chat/ContactAppBrandIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { localizeHref } from "@/i18n/routing";
import { buildEmailHref, buildLineHref, buildWhatsAppHref } from "@/lib/contact-links";
import { cn } from "@/lib/utils";

export function MessagingButtons({
  contactEmail,
  whatsappNumber,
  lineId,
  lineUrl,
  lineQrImage,
  quiet = false,
}: {
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
  lineUrl?: string;
  lineQrImage?: string;
  quiet?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("Chat");
  const whatsappHref = buildWhatsAppHref(whatsappNumber);
  const emailHref = buildEmailHref(contactEmail);
  const fallbackLineHref = localizeHref("/#contact", locale);
  const lineHref = buildLineHref({ fallbackHref: fallbackLineHref, lineId, lineUrl });
  const hasLineContact = Boolean(lineUrl?.trim() || lineId?.trim());
  const linkClassName =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 transition hover:bg-gold/10 hover:text-navy focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:text-slate-200 dark:hover:text-gold";

  return (
    <div className={cn("flex items-center gap-2", quiet && "opacity-90")}>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noreferrer"
        aria-label="Open WhatsApp chat"
        title="WhatsApp"
        className={linkClassName}
      >
        <ContactAppBrandIcon app="whatsapp" />
      </a>
      <a
        href={lineHref}
        target={hasLineContact ? "_blank" : undefined}
        rel={hasLineContact ? "noreferrer" : undefined}
        aria-label="Open LINE chat"
        title="LINE"
        className={cn(linkClassName, lineQrImage && "md:hidden")}
      >
        <ContactAppBrandIcon app="line" />
      </a>
      {lineQrImage ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Open LINE chat"
              title="LINE"
              className={cn(linkClassName, "hidden md:inline-flex")}
            >
              <ContactAppBrandIcon app="line" />
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-sm text-center sm:text-center">
            <DialogHeader className="items-center text-center sm:text-center">
              <DialogTitle>{t("lineQrTitle")}</DialogTitle>
              <DialogDescription>
                {t("lineQrDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border border-border bg-white p-3 shadow-sm">
              <Image
                src={lineQrImage}
                alt="LINE QR code for contacting us"
                width={320}
                height={320}
                className="h-auto w-full"
              />
            </div>
            <a
              href={lineHref}
              target={hasLineContact ? "_blank" : undefined}
              rel={hasLineContact ? "noreferrer" : undefined}
              className="mx-auto inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
            >
              {t("lineQrFallback")}
            </a>
          </DialogContent>
        </Dialog>
      ) : null}
      <a
        href={emailHref}
        aria-label="Email concierge"
        title="Email"
        className={linkClassName}
      >
        <Mail className="h-5 w-5" />
      </a>
    </div>
  );
}
