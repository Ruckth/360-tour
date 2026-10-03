"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { ChatContextProvider, useChatPageContext } from "@/components/chat/ChatContext";
import { SiteFooter } from "@/components/global/SiteFooter";
import { SiteHeader } from "@/components/global/SiteHeader";
import { stripLocalePrefix } from "@/i18n/routing";
import { buildChatHref } from "@/lib/chat/navigation";
import { loadAIChatWidget, preloadAIChatWidget } from "@/lib/chat/preload";
import { resort } from "@/lib/data/resort-config";
import { useDeferredReady } from "@/lib/react/use-deferred-ready";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const LazyAIChatWidget = dynamic(loadAIChatWidget, { ssr: false });

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

/**
 * Public chat entry point. The heavy chat widget loads ONLY on launcher intent:
 * - hover / focus / touch prefetches the chunk (no render);
 * - click / Enter / Space mounts the widget and opens it.
 *
 * Until then a real, keyboard-operable launcher is shown: a desktop <button> (opens the overlay)
 * and a mobile <a href> to the localized /chat page carrying property context — the <a> works
 * with no JS and before the widget loads. Programmatic opens from other components still work:
 * they dispatch `open-concierge-chat`, which mounts the widget with `initialOpen`.
 */
function IntentionalChatWidget() {
  const locale = useLocale();
  const t = useTranslations("Chat");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chatContext = useChatPageContext();
  const normalizedPath = stripLocalePrefix(pathname);
  const propertySlug = chatContext?.context.propertySlug;

  const [activated, setActivated] = useState(false);

  const chatHref = buildChatHref({
    locale,
    pathname,
    propertySlug,
    search: searchParams,
  });
  const hideMobileRoomTrigger = normalizedPath.startsWith("/rooms/");

  function open() {
    setActivated(true);
  }

  // Programmatic opens from other components (villa pages, booking CTAs) activate the widget.
  useEffect(() => {
    if (activated) return;
    function onOpen() {
      setActivated(true);
    }
    window.addEventListener("open-concierge-chat", onOpen);
    return () => window.removeEventListener("open-concierge-chat", onOpen);
  }, [activated]);

  if (activated) {
    return (
      // The widget opens itself once mounted and focuses its composer (useChatSession).
      <LazyAIChatWidget
        initialOpen
        contactEmail={resort.contactEmail}
        whatsappNumber={resort.whatsapp}
        lineId={resort.lineId}
        lineUrl={resort.lineUrl}
        lineQrImage={resort.lineQrImage}
      />
    );
  }

  return (
    <>
      {/* Mobile: a plain link to the dedicated chat page — works with no JS, before the widget loads.
          Hidden on room pages (which have their own in-page trigger) but still carries context. */}
      <Link
        href={chatHref}
        data-testid="chat-launcher-link"
        className={[
          "fixed bottom-5 right-5 z-50 h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105",
          hideMobileRoomTrigger ? "hidden" : "flex md:hidden",
        ].join(" ")}
        aria-label={t("open")}
      >
        <MessageCircle className="h-6 w-6" />
      </Link>
      {/* Desktop: a real button that loads + opens the overlay on activation. */}
      <button
        type="button"
        data-testid="chat-launcher-button"
        onClick={open}
        onPointerEnter={preloadAIChatWidget}
        onFocus={preloadAIChatWidget}
        onTouchStart={preloadAIChatWidget}
        aria-label={t("open")}
        aria-haspopup="dialog"
        className="fixed bottom-5 right-5 z-50 hidden h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105 md:flex"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    </>
  );
}

/**
 * Root chrome. Public pages are served from the [locale] segment, whose layout renders
 * PublicSiteShell (with the data it needs), so admin and auth pages never load villa data.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  // Sign-in and sign-up live outside [locale] (see src/proxy.ts) but keep the public header and footer.
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
    return <PublicSiteShell>{children}</PublicSiteShell>;
  }

  return children;
}

/** Header, footer and chat widget for public pages. `hasReviews` shows the header's Reviews link. */
export function PublicSiteShell({ children, hasReviews }: { children: ReactNode; hasReviews?: boolean }) {
  const pathname = usePathname();
  const normalizedPath = stripLocalePrefix(pathname);

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
        <IntentionalChatWidget />
      </ChatContextProvider>
    </div>
  );
}
