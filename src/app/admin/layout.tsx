import type { Viewport } from "next";
import type { AbstractIntlMessages } from "next-intl";
import { getLocale } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CommerceMessages } from "@/components/checkout/commerce-messages";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";
import { isClerkConfigured } from "@/lib/clerk-config";

// Edge to edge on notched phones and iPads; the shell pads itself with the safe-area insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f17" },
  ],
};

/**
 * Commerce copy (messages/commerce/<locale>.json) for checkout, receipts and the header's Approvals,
 * which every admin page carries. Read on the server, so it ships in the page payload, not in a chunk.
 */
const COMMERCE_MESSAGES: Record<Locale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import("../../../messages/commerce/en.json"),
  th: () => import("../../../messages/commerce/th.json"),
  "zh-CN": () => import("../../../messages/commerce/zh-CN.json"),
  ja: () => import("../../../messages/commerce/ja.json"),
  ko: () => import("../../../messages/commerce/ko.json"),
  fr: () => import("../../../messages/commerce/fr.json"),
  de: () => import("../../../messages/commerce/de.json"),
  es: () => import("../../../messages/commerce/es.json"),
  ru: () => import("../../../messages/commerce/ru.json"),
  it: () => import("../../../messages/commerce/it.json"),
  hi: () => import("../../../messages/commerce/hi.json"),
};
async function commerceMessages(locale: Locale) {
  return (await COMMERCE_MESSAGES[locale]()).default;
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!isClerkConfigured()) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-5">
        <section className="w-full max-w-xl border border-border bg-card p-8 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Admin setup
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
            Clerk is required for admin
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
            configure the Convex `CLERK_JWT_ISSUER_DOMAIN` plus `ADMIN_EMAILS`
            environment variables before opening the dashboard.
          </p>
        </section>
      </main>
    );
  }

  const locale = await getLocale();
  const commerce = await commerceMessages(isLocale(locale) ? locale : defaultLocale);
  return (
    <CommerceMessages messages={commerce}>
      <Suspense fallback={null}>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </CommerceMessages>
  );
}
