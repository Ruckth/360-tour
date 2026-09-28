"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { ChatContextProvider, useChatPageContext } from "@/components/chat/ChatContext";
import { SiteFooter } from "@/components/global/SiteFooter";
import { SiteHeader } from "@/components/global/SiteHeader";
import { stripLocalePrefix } from "@/i18n/routing";
import { buildChatHref } from "@/lib/chat/navigation";
import { resort } from "@/lib/data/resort-config";
import { useDeferredReady } from "@/lib/react/use-deferred-ready";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

const LazyAIChatWidget = dynamic(
  () => import("@/components/chat/AIChatWidget").then((mod) => mod.AIChatWidget),
  { ssr: false },
);

const LazyDemoDisclaimerDialog = dynamic(
  () =>
    import("@/components/global/DemoDisclaimerDialog").then(
      (mod) => mod.DemoDisclaimerDialog,
    ),
  { ssr: false },
);

function DeferredDemoDisclaimer() {
  const ready = useDeferredReady(700);
  return ready ? <LazyDemoDisclaimerDialog /> : null;
}

function ChatLauncherFallback() {
  const locale = useLocale();
  const t = useTranslations("Chat");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chatContext = useChatPageContext();
  const normalizedPath = stripLocalePrefix(pathname);
  const chatHref = buildChatHref({
    locale,
    pathname,
    propertySlug: chatContext?.context.propertySlug,
    search: searchParams,
  });
  const hideMobileRoomTrigger = normalizedPath.startsWith("/rooms/");

  return (
    <Link
      href={chatHref}
      className={[
        "fixed bottom-5 right-5 z-50 h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105",
        hideMobileRoomTrigger ? "hidden" : "flex md:hidden",
      ].join(" ")}
      aria-label={t("open")}
    >
      <MessageCircle className="h-6 w-6" />
    </Link>
  );
}

function DeferredAIChatWidget() {
  const ready = useDeferredReady();

  if (!ready) {
    return <ChatLauncherFallback />;
  }

  return (
    <LazyAIChatWidget
      contactEmail={resort.contactEmail}
      whatsappNumber={resort.whatsapp}
      lineId={resort.lineId}
      lineUrl={resort.lineUrl}
      lineQrImage={resort.lineQrImage}
    />
  );
}

export function SiteShell({ children, hasReviews }: { children: ReactNode; hasReviews?: boolean }) {
  const pathname = usePathname();
  const normalizedPath = stripLocalePrefix(pathname);

  if (pathname.startsWith("/admin")) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  if (normalizedPath === "/chat") {
    return (
      <div className="min-h-[100dvh] overflow-hidden bg-background text-foreground">
        <DeferredDemoDisclaimer />
        <main className="min-h-[100dvh]">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <DeferredDemoDisclaimer />
      <SiteHeader hasReviews={hasReviews} />
      <ChatContextProvider>
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <DeferredAIChatWidget />
      </ChatContextProvider>
    </div>
  );
}
