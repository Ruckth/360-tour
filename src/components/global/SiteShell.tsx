"use client";

import { useHydrated } from "@/platform/hydration";
import dynamic from "@/platform/dynamic";
import Link from "@/platform/link";
import { MessageCircle } from "lucide-react";
import { ChatContextProvider, useChatPageContext } from "@/components/chat/ChatContext";
import { SiteFooter } from "@/components/global/SiteFooter";
import { SiteHeader } from "@/components/global/SiteHeader";
import { stripLocalePrefix } from "@/i18n/routing";
import { buildChatHref, usesFloatingChatOnMobile } from "@/lib/chat/navigation";
import { loadAIChatWidget, preloadAIChatWidget } from "@/lib/chat/preload";
import { resort } from "@/lib/data/resort-config";
import { registerGuestBottomControl } from "@/lib/guest-bottom-inset";
import { useLocale, useTranslations } from "@/platform/intl";
import { usePathname, useSearchParams } from "@/platform/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

const LazyAIChatWidget = dynamic(loadAIChatWidget, { ssr: false });


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
  const hydrated = useHydrated();
  const locale = useLocale();
  const t = useTranslations("Chat");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chatContext = useChatPageContext();
  const propertySlug = chatContext?.context.propertySlug;

  const [activated, setActivated] = useState(false);
  const mobileLauncherRef = useRef<HTMLDivElement>(null);
  const desktopLauncherRef = useRef<HTMLButtonElement>(null);

  const chatHref = buildChatHref({
    locale,
    pathname,
    propertySlug,
    search: searchParams,
  });
  const showMobileTrigger = usesFloatingChatOnMobile(pathname);

  useEffect(() => {
    if (activated) return;
    const cleanups: (() => void)[] = [];
    if (mobileLauncherRef.current && showMobileTrigger) {
      cleanups.push(
        registerGuestBottomControl("chat-launcher-mobile", mobileLauncherRef.current, {
          fallbackPx: 88,
          checkHorizontalOverlap: true,
        }),
      );
    }
    if (desktopLauncherRef.current) {
      cleanups.push(
        registerGuestBottomControl("chat-launcher-desktop", desktopLauncherRef.current, {
          fallbackPx: 88,
          checkHorizontalOverlap: true,
        }),
      );
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [activated, showMobileTrigger]);

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
      // The widget opens itself and moves focus into the overlay once mounted.
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
      {/* Use the in-page actions on home, room and booking pages. */}
      {showMobileTrigger ? (
        <div
          ref={mobileLauncherRef}
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] right-5 z-50 flex md:hidden"
        >
          <Link
            href={chatHref}
            data-testid="chat-launcher-link"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105"
            aria-label={t("open")}
          >
            <MessageCircle className="h-6 w-6" />
          </Link>
        </div>
      ) : null}
      {/* Desktop: a real button that loads + opens the overlay on activation. */}
      <button
        ref={desktopLauncherRef}
        type="button"
        data-testid="chat-launcher-button"
        disabled={!hydrated}
        onClick={open}
        onPointerEnter={preloadAIChatWidget}
        onFocus={preloadAIChatWidget}
        onTouchStart={preloadAIChatWidget}
        aria-label={t("open")}
        aria-haspopup="dialog"
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] right-5 z-50 hidden h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105 md:flex"
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
    return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
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
        <main tabIndex={-1} className="min-h-[100dvh]">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader hasReviews={hasReviews} />
      <ChatContextProvider>
        <main tabIndex={-1} className="flex-1">{children}</main>
        <SiteFooter />
        <IntentionalChatWidget />
      </ChatContextProvider>
    </div>
  );
}
