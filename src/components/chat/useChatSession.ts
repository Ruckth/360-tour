"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useOptionalConvex } from "@/lib/react/convex";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useChatPageContext } from "@/components/chat/ChatContext";
import type { ContactForm } from "@/components/chat/ChatComposer";
import type {
  ChatMessage as Message,
  ChatSuggestion,
} from "@/components/chat/chat-types";
import {
  askConcierge,
  claimChatBrowserHandoff,
  closeChatSession,
  createChatBrowserHandoff,
  createChatSession,
  getReusableChatSession,
  getChatMessages,
  getNextChatSuggestions,
  identifyChatVisitor,
  markChatSuggestionClicked,
  markChatSuggestionsShown,
  listLiveProperties,
  touchChatSession,
} from "@/lib/react/convex-api";
import {
  selectChatSuggestions,
  type ChatSuggestionId,
} from "@/lib/chat/suggestions";
import {
  getChatActionCard,
  resolveChatActionHint,
  type ChatActionCard,
  type ChatActionHint,
} from "@/lib/chat/action-card";
import { localizeHref, stripLocalePrefix } from "@/i18n/routing";
import {
  extractChatBookingContext,
  getBookingPromptKey,
  type ChatBookingContext,
  type ChatVillaRef,
} from "@/lib/chat/booking-intent";
import {
  appendChatExternalParams,
  buildExternalBrowserTarget,
  CHAT_CONTINUE_IN_APP_PARAM,
  CHAT_HANDOFF_PARAM,
  detectChatInAppBrowser,
  shouldBypassChatBrowserGate,
  stripChatHandoffParam,
  type ExternalBrowserTarget,
} from "@/lib/chat/external-browser";
import {
  buildChatHref,
  CHAT_RETURN_TO_PARAM,
  getPathWithSearch,
  getSafeChatReturnTo,
} from "@/lib/chat/navigation";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import {
  clearCachedChatMessages,
  clearKnownChatMessageCaches,
  clearStoredSessionId,
  createAssistantMessage,
  getOrCreateVisitorId,
  getStoredSessionId,
  latestExchangeFromMessages,
  mergeAdminMessages,
  normalizeTranscriptMessages,
  previousUserMessageFor,
  readCachedChatMessages,
  setStoredSessionId,
  withStaffReplyNotice,
  writeCachedChatMessages,
  type LatestExchange,
} from "@/components/chat/session/message-cache";
import {
  CHAT_PAGE_HEADER_OFFSET,
  CHAT_PAGE_MIN_HEIGHT,
  CHAT_PAGE_VIEWPORT_FALLBACK,
  getFocusedFooterInput,
  getKeyboardLayoutMeasurement,
  getKeyboardViewportBaselineHeight,
  isKeyboardOverlayBrowser,
  KEYBOARD_INSET_EPSILON,
  KEYBOARD_PROBE_DELAYS_MS,
  MOBILE_KEYBOARD_THRESHOLD,
  PAGE_COMPOSER_RESERVE_FALLBACK,
  type ChatExperienceMode,
  type KeyboardLayoutMode,
} from "@/components/chat/session/keyboard-viewport";
import { HEARTBEAT_MS, startSessionHeartbeat } from "@/components/chat/session/heartbeat";
import {
  recoverPersistedAssistantMessage as recoverPersistedAssistantMessageLoop,
  reconcilePersistedAssistantMessage as reconcilePersistedAssistantMessageLoop,
  type RecoveryDeps,
} from "@/components/chat/session/transport-recovery";

type StaticChatSuggestion = ChatSuggestion;
type FooterFocusScope = "composer" | "contact" | null;
type EnsureSessionOptions = {
  markOpen?: boolean;
  validateForReuse?: boolean;
  hydrateMessages?: boolean;
  generation?: number;
};

const REUSABLE_CHAT_MESSAGE_LIMIT = 20;
const VISIBLE_FOLLOW_UP_SUGGESTION_LIMIT = 2;

type ChatPanelStyle = CSSProperties & {
  "--chat-keyboard-inset"?: string;
  "--chat-visible-height"?: string;
};

function getBrowserChatMetadata() {
  if (typeof window === "undefined") return {};

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  return {
    currentPath: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer || undefined,
    userAgent: navigator.userAgent || undefined,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    browserLanguage:
      navigator.languages?.join(", ") || navigator.language || undefined,
    screenSize:
      typeof window.screen?.width === "number" &&
      typeof window.screen?.height === "number"
        ? `${window.screen.width}x${window.screen.height}`
        : undefined,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    platform:
      navigatorWithUserAgentData.userAgentData?.platform ||
      navigator.platform ||
      undefined,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function localBookingReplyKey(context: ChatBookingContext) {
  return getBookingPromptKey(context);
}

export type ChatExperienceProps = {
  mode: ChatExperienceMode;
  propertySlug?: string;
  propertyName?: string;
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
  lineUrl?: string;
  lineQrImage?: string;
  /** Overlay only: open once after mount, for a widget loaded by launcher activation. */
  initialOpen?: boolean;
};

export function useChatSession({
  contactEmail,
  mode,
  propertySlug,
  propertyName,
  whatsappNumber,
  lineId,
  lineUrl,
  lineQrImage,
  initialOpen = false,
}: ChatExperienceProps) {
  const isPageMode = mode === "page";
  const t = useTranslations("Chat");
  const locale = useLocale();
  const router = useRouter();
  const convex = useOptionalConvex();
  const pageContext = useChatPageContext();
  const activePropertySlug = propertySlug ?? pageContext?.context.propertySlug;
  const activePropertyName = propertyName ?? pageContext?.context.propertyName;
  const [open, setOpen] = useState(isPageMode);
  // Live villa names so guests can name admin-created villas; undefined → bundled list.
  const [villas, setVillas] = useState<ChatVillaRef[]>();
  const [hydrated, setHydrated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messageCacheReady, setMessageCacheReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // Staff took over this session: presets go to them as normal messages and the guest is told
  // a person will reply (once per paused stretch).
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);
  const aiPaused = pausedSessionId !== null && pausedSessionId === sessionId;
  const staffReplyNoticeShownRef = useRef(false);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [latestExchange, setLatestExchange] = useState<LatestExchange | null>(
    null,
  );
  const [trackedSuggestionIds, setTrackedSuggestionIds] = useState<
    ChatSuggestionId[] | null
  >(null);
  const [contactForm, setContactForm] = useState<ContactForm>({
    email: "",
    preferredApp: "whatsapp",
    contactHandle: "",
  });
  const [contactStatus, setContactStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [keyboardLayoutMode, setKeyboardLayoutMode] =
    useState<KeyboardLayoutMode>("none");
  const [footerFocusScope, setFooterFocusScope] =
    useState<FooterFocusScope>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [chatPageViewportHeight, setChatPageViewportHeight] = useState(
    CHAT_PAGE_VIEWPORT_FALLBACK,
  );
  const [composerReserveHeight, setComposerReserveHeight] = useState(
    PAGE_COMPOSER_RESERVE_FALLBACK,
  );
  const [browserGateVisible, setBrowserGateVisible] = useState(false);
  const [browserGateUrl, setBrowserGateUrl] = useState<string | null>(null);
  const [browserGateOpenUrl, setBrowserGateOpenUrl] = useState<string | null>(
    null,
  );
  const [browserGateTargetBrowser, setBrowserGateTargetBrowser] =
    useState<ExternalBrowserTarget["browser"]>("browser");
  const [browserGateCopyStatus, setBrowserGateCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatFooterRef = useRef<HTMLDivElement>(null);
  const contactFormRef = useRef<HTMLFormElement>(null);
  const keyboardInsetRef = useRef(0);
  const keyboardFocusStartedAtRef = useRef(0);
  const keyboardViewportBaselineRef = useRef<number | null>(null);
  const chatGenerationRef = useRef(0);
  const isRestartingChatRef = useRef(false);
  const restoredMessageCacheRef = useRef(false);
  const previousPropertySlugRef = useRef(activePropertySlug);
  const browserGateAttemptedRef = useRef(false);
  const claimedHandoffTokenRef = useRef<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const normalizedPathname = stripLocalePrefix(pathname);
  const currentSearch = searchParams.toString();
  const currentPathWithSearch = getPathWithSearch(pathname, currentSearch);
  const returnToParam = searchParams.get(CHAT_RETURN_TO_PARAM);
  const browserHandoffToken = searchParams.get(CHAT_HANDOFF_PARAM);
  const browserGateBypassed = shouldBypassChatBrowserGate(searchParams);
  const chatReturnHref = useMemo(
    () => getSafeChatReturnTo(returnToParam) ?? localizeHref("/", locale),
    [locale, returnToParam],
  );

  const title = activePropertyName
    ? t("propertyTitle", { propertyName: activePropertyName })
    : t("defaultTitle");
  const suggestions = useMemo(
    (): StaticChatSuggestion[] => [
      {
        id: "availability",
        text: t("suggestionAvailability"),
        source: "static",
      },
      {
        id: "totalPrice",
        text: t("suggestionTotalPrice"),
        source: "static",
      },
      {
        id: "direct",
        text: t("suggestionDirect"),
        source: "static",
      },
      {
        id: "tour",
        text: t("suggestion360"),
        source: "static",
      },
      {
        id: "guests",
        text: t("suggestionGuests"),
        source: "static",
      },
      {
        id: "contact",
        text: t("suggestionContact"),
        source: "static",
      },
      {
        id: "couple",
        text: t("suggestionCouple"),
        source: "static",
      },
      {
        id: "family",
        text: t("suggestionFamily"),
        source: "static",
      },
      {
        id: "cancellation",
        text: t("suggestionCancellation"),
        source: "static",
      },
      {
        id: "airport",
        text: t("suggestionAirport"),
        source: "static",
      },
      {
        id: "amenitiesIncluded",
        text: t("suggestionAmenitiesIncluded"),
        source: "static",
      },
      {
        id: "location",
        text: t("suggestionLocation"),
        source: "static",
      },
    ],
    [t],
  );
  const orderedStaticSuggestions = useMemo(
    () =>
      selectChatSuggestions({
        candidates: suggestions,
        activePropertySlug: activePropertySlug || undefined,
        latestUserMessage: latestExchange?.userMessage,
        latestAssistantMessage: latestExchange?.assistantMessage,
        clickedSuggestionId: latestExchange?.clickedSuggestionId,
        limit: suggestions.length,
      }) as StaticChatSuggestion[],
    [activePropertySlug, latestExchange, suggestions],
  );
  const visibleSuggestionLimit = latestExchange?.assistantMessage
    ? VISIBLE_FOLLOW_UP_SUGGESTION_LIMIT
    : 6;
  const fallbackVisibleSuggestions = useMemo(
    () => orderedStaticSuggestions.slice(0, visibleSuggestionLimit),
    [orderedStaticSuggestions, visibleSuggestionLimit],
  );
  const visibleSuggestions = useMemo((): ChatSuggestion[] => {
    if (!trackedSuggestionIds) return fallbackVisibleSuggestions;
    const byId = new Map(
      suggestions.map((suggestion) => [suggestion.id, suggestion]),
    );
    return trackedSuggestionIds
      .map((id) => byId.get(id))
      .filter((suggestion): suggestion is StaticChatSuggestion =>
        Boolean(suggestion),
      );
  }, [fallbackVisibleSuggestions, suggestions, trackedSuggestionIds]);
  const latestAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") return index;
    }
    return -1;
  }, [messages]);
  useEffect(() => {
    if (!convex || !open || villas) return;
    let active = true;
    listLiveProperties(convex)
      .then((rows) => {
        if (active) setVillas(rows.map(({ slug, name }) => ({ slug, name })));
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [convex, open, villas]);
  const messageActionCards = useMemo<ChatActionCard[]>(
    () =>
      messages.map((message, index) => {
        if (message.role !== "assistant") return { type: "none" };

        const clickedSuggestionId =
          index === latestAssistantIndex
            ? latestExchange?.clickedSuggestionId
            : null;
        return getChatActionCard({
          latestUserMessage: previousUserMessageFor(messages, index),
          latestAssistantMessage: message.content,
          activePropertySlug: activePropertySlug || undefined,
          villas,
          actionHint: message.action,
          clickedSuggestionId,
        });
      }),
    [
      activePropertySlug,
      latestAssistantIndex,
      latestExchange?.clickedSuggestionId,
      messages,
      villas,
    ],
  );
  const canShowMessageSuggestions =
    !isTyping &&
    latestAssistantIndex >= 0 &&
    latestAssistantIndex === messages.length - 1;
  const latestActionCard =
    latestAssistantIndex >= 0 ? messageActionCards[latestAssistantIndex] : null;
  const hasLatestActionCard = Boolean(
    latestActionCard && latestActionCard.type !== "none",
  );
  const chatInputDisabled =
    !messageCacheReady ||
    isTyping ||
    (Boolean(convex) && !sessionReady && messages.length === 0) ||
    (isHydratingSession && messages.length === 0);
  const hideFloatingTriggerOnMobileRoom =
    normalizedPathname.startsWith("/rooms/");
  const chatHref = useMemo(() => {
    return buildChatHref({
      locale,
      pathname,
      propertySlug: activePropertySlug,
      search: currentSearch,
    });
  }, [activePropertySlug, currentSearch, locale, pathname]);
  const shouldLockScroll =
    mode === "overlay" &&
    open &&
    typeof window !== "undefined" &&
    !window.matchMedia("(min-width: 768px)").matches;
  const keyboardInsetActive =
    keyboardLayoutMode === "overlayInset" ||
    keyboardLayoutMode === "overlayFallback";
  const contactFocused = footerFocusScope === "contact";
  const mobileKeyboardActive =
    isMobileViewport &&
    (footerFocusScope !== null || keyboardLayoutMode !== "none");
  const hideAuxiliaryControls = mobileKeyboardActive;
  const hideContactDetails = mobileKeyboardActive && !contactFocused;
  const hideMainComposer = isMobileViewport && contactFocused;
  const overlayComposerDocked =
    mode === "overlay" && mobileKeyboardActive && keyboardInsetActive;
  const pageComposerDocked =
    mode === "page" && mobileKeyboardActive && keyboardInsetActive;
  const footerReserveHeight = Math.max(
    composerReserveHeight,
    PAGE_COMPOSER_RESERVE_FALLBACK,
  );
  const floatingContactActionsVisible = !hideAuxiliaryControls;
  const floatingContactActionsStyle = floatingContactActionsVisible
    ? {
        bottom: `calc(${footerReserveHeight}px + 0.75rem)`,
      }
    : undefined;
  const chatFooterStyle = overlayComposerDocked
    ? {
        bottom: mobileKeyboardInset,
        left: 0,
        position: "fixed" as const,
        right: 0,
        zIndex: 60,
      }
    : pageComposerDocked
      ? ({
          "--chat-keyboard-inset": `${mobileKeyboardInset}px`,
          "--chat-visible-height": chatPageViewportHeight,
          bottom: keyboardInsetActive ? "var(--chat-keyboard-inset)" : 0,
          left: 0,
          marginInline: "auto",
          maxWidth: "48rem",
          position: "fixed" as const,
          right: 0,
          transform: "translateZ(0)",
          width: "100%",
          zIndex: 60,
          maxHeight: "calc(var(--chat-visible-height) - 0.75rem)",
          overflowY: "auto",
          overscrollBehavior: "contain",
        } satisfies ChatPanelStyle)
      : undefined;
  const messagesStyle = overlayComposerDocked
    ? { paddingBottom: "1rem" }
    : pageComposerDocked
      ? {
          paddingBottom: `calc(${footerReserveHeight}px + env(safe-area-inset-bottom, 0px))`,
        }
      : floatingContactActionsVisible
        ? { paddingBottom: "4.75rem" }
        : undefined;
  useBodyScrollLock(shouldLockScroll);

  const updateChatPageViewportHeight = useCallback(() => {
    if (mode !== "page" || typeof window === "undefined") return;

    const visualViewportHeight =
      window.visualViewport?.height ?? window.innerHeight;
    const nextHeight = Math.max(
      CHAT_PAGE_MIN_HEIGHT,
      Math.round(visualViewportHeight - CHAT_PAGE_HEADER_OFFSET),
    );
    setChatPageViewportHeight(`${nextHeight}px`);
  }, [mode]);

  const chatPanelStyle =
    mode === "page"
      ? ({
          "--chat-keyboard-inset": `${mobileKeyboardInset}px`,
          "--chat-visible-height": chatPageViewportHeight,
          height: "var(--chat-visible-height)",
        } satisfies ChatPanelStyle)
      : undefined;

  const scrollTranscriptToEnd = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (mode === "page") {
        const messagesNode = chatMessagesRef.current;
        if (messagesNode) {
          messagesNode.scrollTo({ top: messagesNode.scrollHeight, behavior });
          return;
        }
      }

      const messagesNode = chatMessagesRef.current;
      if (messagesNode)
        messagesNode.scrollTo({ top: messagesNode.scrollHeight, behavior });
    },
    [mode],
  );

  const isTranscriptNearEnd = useCallback(() => {
    const messagesNode = chatMessagesRef.current;
    if (!messagesNode) return true;

    const remainingScroll =
      messagesNode.scrollHeight -
      messagesNode.scrollTop -
      messagesNode.clientHeight;
    return remainingScroll < 96;
  }, []);

  const refreshChatPageAfterKeyboardChange = useCallback(() => {
    if (mode !== "page" || typeof window === "undefined") return;

    const shouldKeepTranscriptPinned = isTranscriptNearEnd();
    updateChatPageViewportHeight();
    if (shouldKeepTranscriptPinned) scrollTranscriptToEnd();
    KEYBOARD_PROBE_DELAYS_MS.forEach((delay) => {
      window.setTimeout(() => {
        updateChatPageViewportHeight();
        inputRef.current?.scrollIntoView({ block: "nearest" });
        if (shouldKeepTranscriptPinned) scrollTranscriptToEnd();
      }, delay);
    });
  }, [
    isTranscriptNearEnd,
    mode,
    scrollTranscriptToEnd,
    updateChatPageViewportHeight,
  ]);

  const focusFooterInput = useCallback(
    (scope: Exclude<FooterFocusScope, null>) => {
      keyboardFocusStartedAtRef.current = Date.now();
      keyboardViewportBaselineRef.current ??=
        getKeyboardViewportBaselineHeight();
      setFooterFocusScope(scope);
      refreshChatPageAfterKeyboardChange();
    },
    [refreshChatPageAfterKeyboardChange],
  );

  const clearFooterFocusAfterBlur = useCallback(() => {
    window.setTimeout(() => {
      const focusedInput = getFocusedFooterInput(chatFooterRef.current);
      if (focusedInput === inputRef.current) {
        setFooterFocusScope("composer");
        refreshChatPageAfterKeyboardChange();
        return;
      }

      if (focusedInput && contactFormRef.current?.contains(focusedInput)) {
        setFooterFocusScope("contact");
        refreshChatPageAfterKeyboardChange();
        return;
      }

      keyboardFocusStartedAtRef.current = 0;
      keyboardViewportBaselineRef.current = null;
      setFooterFocusScope(null);
      refreshChatPageAfterKeyboardChange();
    }, 120);
  }, [refreshChatPageAfterKeyboardChange]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (mode !== "page" || !hydrated) return;
    if (browserGateBypassed || browserHandoffToken) {
      setBrowserGateVisible(false);
      setBrowserGateTargetBrowser("browser");
      return;
    }

    const detection = detectChatInAppBrowser(navigator.userAgent);
    setBrowserGateVisible(detection.isInAppBrowser);
    if (detection.isInAppBrowser) {
      setBrowserGateTargetBrowser(
        detection.platform === "ios"
          ? "safari"
          : detection.platform === "android"
            ? "chrome"
            : "browser",
      );
    }
    if (!detection.isInAppBrowser) {
      browserGateAttemptedRef.current = false;
      setBrowserGateUrl(null);
      setBrowserGateOpenUrl(null);
      setBrowserGateTargetBrowser("browser");
    }
  }, [browserGateBypassed, browserHandoffToken, hydrated, mode]);

  useEffect(() => {
    const storedSessionId = getStoredSessionId();
    const cachedTranscript =
      readCachedChatMessages(storedSessionId) ?? readCachedChatMessages(null);

    if (storedSessionId) {
      setSessionId(storedSessionId);
    }

    if (cachedTranscript) {
      restoredMessageCacheRef.current = true;
      setMessages(cachedTranscript.messages);
      setLatestExchange(
        cachedTranscript.latestExchange ??
          latestExchangeFromMessages(cachedTranscript.messages),
      );
    }

    setMessageCacheReady(true);
  }, []);

  useEffect(() => {
    if (!messageCacheReady) return;
    if (isRestartingChatRef.current) return;
    if (!messages.length) return;

    writeCachedChatMessages(
      sessionId ?? getStoredSessionId(),
      messages,
      latestExchange ?? latestExchangeFromMessages(messages),
    );
  }, [latestExchange, messageCacheReady, messages, sessionId]);

  useEffect(() => {
    if (!messageCacheReady || convex) return;
    setSessionReady(true);
    setIsHydratingSession(false);
  }, [convex, messageCacheReady]);

  useEffect(() => {
    if (previousPropertySlugRef.current === activePropertySlug) return;
    previousPropertySlugRef.current = activePropertySlug;
    setLatestExchange(null);
    setTrackedSuggestionIds(null);
  }, [activePropertySlug]);

  const createFreshSession = useCallback(
    async (generation = chatGenerationRef.current) => {
      if (!convex) return null;
      const id = await createChatSession(convex, {
        propertySlug: activePropertySlug || undefined,
        channel: "web",
        visitorId: getOrCreateVisitorId(),
        ...getBrowserChatMetadata(),
      });
      if (generation !== chatGenerationRef.current) return null;
      setStoredSessionId(id);
      setSessionId(id);
      return id;
    },
    [activePropertySlug, convex],
  );

  const hydrateExistingSession = useCallback(
    async (
      id: string,
      markOpen = false,
      hydrateMessages = true,
      enforceReusableLimit = true,
      generation = chatGenerationRef.current,
    ) => {
      if (!convex) return null;
      await touchChatSession(convex, {
        sessionId: id,
        propertySlug: activePropertySlug || undefined,
        ...getBrowserChatMetadata(),
        isOpen: markOpen,
      });

      if (generation !== chatGenerationRef.current) return null;
      setStoredSessionId(id);
      setSessionId(id);

      if (!hydrateMessages) {
        return id;
      }

      const transcript = await getChatMessages(convex, {
        sessionId: id,
        limit: REUSABLE_CHAT_MESSAGE_LIMIT,
      });
      if (
        enforceReusableLimit &&
        transcript.length >= REUSABLE_CHAT_MESSAGE_LIMIT
      ) {
        throw new Error("Chat session has reached the reusable message limit.");
      }

      if (generation !== chatGenerationRef.current) return null;
      const restoredMessages = normalizeTranscriptMessages(transcript);
      setMessages(restoredMessages);
      setLatestExchange(latestExchangeFromMessages(restoredMessages));
      return id;
    },
    [activePropertySlug, convex],
  );

  const ensureSession = useCallback(
    async ({
      markOpen = false,
      validateForReuse = false,
      hydrateMessages = false,
      generation = chatGenerationRef.current,
    }: EnsureSessionOptions = {}) => {
      if (!convex) return null;
      if (
        browserHandoffToken &&
        claimedHandoffTokenRef.current !== browserHandoffToken
      ) {
        claimedHandoffTokenRef.current = browserHandoffToken;
        try {
          const claimedSessionId = await claimChatBrowserHandoff(convex, {
            token: browserHandoffToken,
          });
          router.replace(stripChatHandoffParam(currentPathWithSearch));
          if (claimedSessionId) {
            return await hydrateExistingSession(
              claimedSessionId,
              markOpen,
              hydrateMessages,
              false,
              generation,
            );
          }
        } catch {
          router.replace(stripChatHandoffParam(currentPathWithSearch));
        }
      }

      if (sessionId) {
        if (validateForReuse) {
          try {
            await hydrateExistingSession(
              sessionId,
              markOpen,
              hydrateMessages,
              true,
              generation,
            );
            if (generation !== chatGenerationRef.current) return null;
            return sessionId;
          } catch {
            if (generation !== chatGenerationRef.current) return null;
            clearStoredSessionId();
            clearCachedChatMessages(sessionId);
            setSessionId(null);
            if (hydrateMessages && !restoredMessageCacheRef.current) {
              setMessages([]);
              setLatestExchange(null);
            }
            return await createFreshSession(generation);
          }
        }

        if (markOpen) {
          await touchChatSession(convex, {
            sessionId,
            propertySlug: activePropertySlug || undefined,
            ...getBrowserChatMetadata(),
            isOpen: true,
          });
        }
        if (generation !== chatGenerationRef.current) return null;
        return sessionId;
      }

      const storedId = getStoredSessionId();
      if (storedId) {
        try {
          await hydrateExistingSession(
            storedId,
            markOpen,
            hydrateMessages,
            true,
            generation,
          );
          if (generation !== chatGenerationRef.current) return null;
          return storedId;
        } catch {
          if (generation !== chatGenerationRef.current) return null;
          clearStoredSessionId();
          clearCachedChatMessages(storedId);
        }
      }

      const visitorId = getOrCreateVisitorId();
      if (visitorId) {
        try {
          const reusableSession = await getReusableChatSession(convex, {
            visitorId,
            messageLimit: REUSABLE_CHAT_MESSAGE_LIMIT,
          });
          if (reusableSession?._id) {
            return await hydrateExistingSession(
              reusableSession._id,
              markOpen,
              hydrateMessages,
              true,
              generation,
            );
          }
        } catch {
          // If lookup fails, create a clean session so chat stays available.
        }
      }

      return await createFreshSession(generation);
    },
    [
      activePropertySlug,
      browserHandoffToken,
      convex,
      createFreshSession,
      currentPathWithSearch,
      hydrateExistingSession,
      router,
      sessionId,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadTrackedStaticSuggestions() {
      setTrackedSuggestionIds(null);
      if (!convex || !sessionId || orderedStaticSuggestions.length === 0)
        return;

      try {
        const nextSuggestions = await getNextChatSuggestions(convex, {
          sessionId,
          candidateSuggestionIds: orderedStaticSuggestions.map(
            (suggestion) => suggestion.id,
          ),
          limit: visibleSuggestionLimit,
        });
        if (cancelled) return;

        if (nextSuggestions.length > 0) {
          await markChatSuggestionsShown(convex, {
            sessionId,
            suggestions: nextSuggestions,
          }).catch(() => null);
          if (cancelled) return;
        }

        const validIds = new Set(
          suggestions.map((suggestion) => suggestion.id),
        );
        setTrackedSuggestionIds(
          nextSuggestions
            .map((suggestion) => suggestion.suggestionId)
            .filter((id): id is ChatSuggestionId =>
              validIds.has(id as ChatSuggestionId),
            ),
        );
      } catch {
        if (!cancelled) setTrackedSuggestionIds(null);
      }
    }

    void loadTrackedStaticSuggestions();
    return () => {
      cancelled = true;
    };
  }, [
    convex,
    orderedStaticSuggestions,
    sessionId,
    suggestions,
    visibleSuggestionLimit,
  ]);

  useEffect(() => {
    if (mode !== "page" || !browserGateVisible || !messageCacheReady) return;
    if (browserGateAttemptedRef.current) return;
    browserGateAttemptedRef.current = true;

    let cancelled = false;
    let fallbackTimeout = 0;

    async function openExternalBrowser() {
      let handoffToken: string | undefined;
      try {
        const id = await ensureSession({
          markOpen: true,
          validateForReuse: true,
          hydrateMessages: false,
        });
        if (id && convex) {
          handoffToken = await createChatBrowserHandoff(convex, {
            sessionId: id,
          });
        }
      } catch {
        // The browser link still works without a restorable Convex session.
      }

      if (cancelled) return;

      const browserUrl = appendChatExternalParams(window.location.href, {
        handoffToken,
      });
      const target = buildExternalBrowserTarget(
        browserUrl,
        navigator.userAgent,
      );
      setBrowserGateUrl(browserUrl);
      setBrowserGateOpenUrl(target.url);
      setBrowserGateTargetBrowser(target.browser);

      fallbackTimeout = window.setTimeout(() => {
        setBrowserGateCopyStatus("idle");
      }, 1200);
      window.location.href = target.url;
    }

    void openExternalBrowser();

    return () => {
      cancelled = true;
      if (fallbackTimeout) window.clearTimeout(fallbackTimeout);
    };
  }, [browserGateVisible, convex, ensureSession, messageCacheReady, mode]);

  const primeSessionForOpen = useCallback(async () => {
    const generation = chatGenerationRef.current;
    if (!convex || !messageCacheReady) {
      setSessionReady(true);
      return;
    }

    const shouldHydrateMessages =
      !restoredMessageCacheRef.current && messages.length === 0;
    setIsHydratingSession(true);
    try {
      await ensureSession({
        markOpen: true,
        validateForReuse: true,
        hydrateMessages: shouldHydrateMessages,
        generation,
      });
    } catch {
      // Chat can still operate from the local transcript if the session touch fails.
    } finally {
      if (generation !== chatGenerationRef.current) return;
      setSessionReady(true);
      setIsHydratingSession(false);
    }
  }, [convex, ensureSession, messageCacheReady, messages.length]);

  const openChat = useCallback(() => {
    if (mode === "page") return;
    setMounted(true);
    setOpen(true);
    setSessionReady(false);
    void primeSessionForOpen();
  }, [mode, primeSessionForOpen]);

  // The launcher mounts this widget lazily on activation; open it exactly once when it arrives,
  // so a first click never depends on the chunk loading within one frame.
  const initialOpenHandledRef = useRef(false);
  useEffect(() => {
    if (!initialOpen || mode !== "overlay" || !hydrated || initialOpenHandledRef.current) return;
    initialOpenHandledRef.current = true;
    openChat();
  }, [hydrated, initialOpen, mode, openChat]);

  const restartChat = useCallback(async () => {
    const previousSessionId = sessionId ?? getStoredSessionId();
    const generation = chatGenerationRef.current + 1;
    chatGenerationRef.current = generation;
    isRestartingChatRef.current = true;
    clearKnownChatMessageCaches(previousSessionId);
    clearStoredSessionId();
    restoredMessageCacheRef.current = false;
    setSessionReady(false);
    setIsHydratingSession(false);
    setSessionId(null);
    setMessages([]);
    setLatestExchange(null);
    setTrackedSuggestionIds(null);
    setInput("");
    setIsTyping(false);
    setContactStatus("idle");
    setOpen(true);

    if (!convex) {
      isRestartingChatRef.current = false;
      setSessionReady(true);
      return;
    }

    try {
      if (previousSessionId) {
        await closeChatSession(convex, { sessionId: previousSessionId }).catch(
          () => undefined,
        );
      }
      if (generation !== chatGenerationRef.current) return;
      const id = await createFreshSession(generation);
      if (generation !== chatGenerationRef.current) return;
      if (!id) throw new Error("No chat session");
      setSessionReady(true);
    } catch {
      if (generation !== chatGenerationRef.current) return;
      setSessionReady(true);
      setContactStatus("error");
    } finally {
      if (generation === chatGenerationRef.current) {
        isRestartingChatRef.current = false;
      }
    }
  }, [convex, createFreshSession, sessionId]);

  const closeChat = useCallback(() => {
    if (mode === "page") {
      setOpen(false);
      if (convex && sessionId) {
        void closeChatSession(convex, { sessionId }).catch(() => undefined);
      }
      router.replace(chatReturnHref);
      return;
    }

    setOpen(false);
    if (convex && sessionId) {
      void closeChatSession(convex, { sessionId }).catch(() => undefined);
    }
  }, [chatReturnHref, convex, mode, router, sessionId]);

  useEffect(() => {
    if (mode !== "page" || !hydrated || browserGateVisible) return;
    router.prefetch(chatReturnHref);
  }, [browserGateVisible, chatReturnHref, hydrated, mode, router]);

  useEffect(() => {
    if (mode !== "page") return;
    if (browserGateVisible) return;
    if (!open || !messageCacheReady || sessionReady || isHydratingSession)
      return;
    void primeSessionForOpen();
  }, [
    browserGateVisible,
    isHydratingSession,
    messageCacheReady,
    mode,
    open,
    primeSessionForOpen,
    sessionReady,
  ]);

  useEffect(() => {
    if (mode === "page") return;
    if (open) return;
    const timeout = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timeout);
  }, [mode, open]);

  useEffect(() => {
    if (mode === "page") return;
    if (!open) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 260);
    return () => window.clearTimeout(timeout);
  }, [mode, open]);

  useEffect(() => {
    if (!open) {
      keyboardInsetRef.current = 0;
      keyboardViewportBaselineRef.current = null;
      setMobileKeyboardInset(0);
      setKeyboardLayoutMode("none");
      setFooterFocusScope(null);
      return;
    }

    const mobileQuery = window.matchMedia("(max-width: 767px)");
    let frame = 0;
    const timeoutIds: number[] = [];

    function updateKeyboardInset() {
      setIsMobileViewport(mobileQuery.matches);
      updateChatPageViewportHeight();
      if (!mobileQuery.matches) {
        keyboardInsetRef.current = 0;
        keyboardViewportBaselineRef.current = null;
        setMobileKeyboardInset(0);
        setKeyboardLayoutMode("none");
        return;
      }

      const focusedInput = getFocusedFooterInput(chatFooterRef.current);
      const focusedInputIsActive = Boolean(focusedInput);
      if (mode === "page" && focusedInputIsActive && !footerFocusScope) {
        keyboardFocusStartedAtRef.current ||= Date.now();
        setFooterFocusScope(
          focusedInput === inputRef.current
            ? "composer"
            : focusedInput && contactFormRef.current?.contains(focusedInput)
              ? "contact"
              : null,
        );
      }
      if (focusedInputIsActive) {
        keyboardViewportBaselineRef.current ??=
          getKeyboardViewportBaselineHeight();
      } else {
        keyboardViewportBaselineRef.current = null;
      }
      const fallbackAllowed = isKeyboardOverlayBrowser();
      const { inset: effectiveInset, layoutMode: nextKeyboardLayoutMode } =
        getKeyboardLayoutMeasurement({
          fallbackAllowed,
          focusedInputIsActive,
          footerNode: chatFooterRef.current,
          inputNode: focusedInput,
          mode,
          viewportBaselineHeight: keyboardViewportBaselineRef.current,
        });
      const previousInset = keyboardInsetRef.current;
      if (
        Math.abs(effectiveInset - previousInset) < KEYBOARD_INSET_EPSILON &&
        effectiveInset !== 0 &&
        nextKeyboardLayoutMode === keyboardLayoutMode
      ) {
        return;
      }

      keyboardInsetRef.current = effectiveInset;
      setMobileKeyboardInset(effectiveInset);
      setKeyboardLayoutMode(nextKeyboardLayoutMode);
      if (
        effectiveInset <= MOBILE_KEYBOARD_THRESHOLD &&
        !focusedInputIsActive
      ) {
        setFooterFocusScope(null);
      }
    }

    function scheduleKeyboardInsetUpdate() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateKeyboardInset);
    }

    scheduleKeyboardInsetUpdate();
    KEYBOARD_PROBE_DELAYS_MS.forEach((delay) => {
      timeoutIds.push(window.setTimeout(scheduleKeyboardInsetUpdate, delay));
    });
    window.visualViewport?.addEventListener(
      "resize",
      scheduleKeyboardInsetUpdate,
    );
    window.visualViewport?.addEventListener(
      "scroll",
      scheduleKeyboardInsetUpdate,
    );
    window.addEventListener("resize", scheduleKeyboardInsetUpdate);
    window.addEventListener("orientationchange", scheduleKeyboardInsetUpdate);
    mobileQuery.addEventListener("change", scheduleKeyboardInsetUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleKeyboardInsetUpdate,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        scheduleKeyboardInsetUpdate,
      );
      window.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      window.removeEventListener(
        "orientationchange",
        scheduleKeyboardInsetUpdate,
      );
      mobileQuery.removeEventListener("change", scheduleKeyboardInsetUpdate);
    };
  }, [
    footerFocusScope,
    keyboardLayoutMode,
    mode,
    open,
    updateChatPageViewportHeight,
  ]);

  useEffect(() => {
    const node = chatFooterRef.current;
    if (!node) return;
    const footerNode = node;

    function updateComposerReserve() {
      setComposerReserveHeight(
        Math.ceil(footerNode.getBoundingClientRect().height),
      );
    }

    updateComposerReserve();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateComposerReserve);
      return () => window.removeEventListener("resize", updateComposerReserve);
    }

    const observer = new ResizeObserver(updateComposerReserve);
    observer.observe(footerNode);
    return () => observer.disconnect();
  }, [hideAuxiliaryControls, mounted, mode, open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        window.matchMedia("(min-width: 768px)").matches
      ) {
        closeChat();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeChat, open]);

  // Presence heartbeat. The scheduler (session/heartbeat.ts) owns the interval and
  // the visibility/focus listeners: it suppresses ticks while the tab is hidden
  // (so a backgrounded guest ages out to "away" after the admin window) and sends
  // an immediate touch when the tab becomes visible or regains focus.
  useEffect(() => {
    if (!open || !convex || browserGateVisible) return;
    return startSessionHeartbeat({
      intervalMs: HEARTBEAT_MS,
      touch: () => {
        void ensureSession({ markOpen: true });
      },
    });
  }, [browserGateVisible, convex, ensureSession, open]);

  useEffect(() => {
    if (!open || !convex || !sessionId || !sessionReady || browserGateVisible) return;
    const watch = convex.watchQuery(
      api.chat.getMessages,
      { sessionId: sessionId as Id<"chatSessions">, limit: 100 },
    );
    const unsubscribe = watch.onUpdate(() => {
      const transcript = watch.localQueryResult();
      if (!transcript) return;
      setMessages((items) => mergeAdminMessages(items, transcript));
    });
    return unsubscribe;
  }, [browserGateVisible, convex, open, sessionId, sessionReady]);

  useEffect(() => {
    if (!open || !convex || !sessionId || !sessionReady || browserGateVisible) return;
    const watch = convex.watchQuery(api.chat.getSession, {
      sessionId: sessionId as Id<"chatSessions">,
    });
    return watch.onUpdate(() => {
      const session = watch.localQueryResult();
      if (session === undefined) return;
      const paused = Boolean(session?.aiPaused);
      if (!paused) staffReplyNoticeShownRef.current = false;
      setPausedSessionId(paused ? sessionId : null);
    });
  }, [browserGateVisible, convex, open, sessionId, sessionReady]);

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactForm.email.trim() && !contactForm.contactHandle.trim()) return;
    if (!convex) {
      setContactStatus("error");
      return;
    }

    setContactStatus("saving");
    try {
      const id = await ensureSession({ markOpen: true });
      if (!id) throw new Error("No chat session");
      await identifyChatVisitor(convex, {
        sessionId: id,
        email: contactForm.email || undefined,
        phone:
          contactForm.preferredApp === "whatsapp"
            ? contactForm.contactHandle || undefined
            : undefined,
        contactApp: contactForm.preferredApp,
        contactHandle: contactForm.contactHandle || undefined,
      });
      setContactStatus("saved");
    } catch {
      setContactStatus("error");
    }
  }

  // Transport recovery (late-reply polling after send errors) lives in
  // session/transport-recovery.ts. We supply the convex-backed transcript loader,
  // the `wait` clock, and a staleness check against the live generation ref so the
  // loops cancel themselves on restart/unmount.
  const buildRecoveryDeps = useCallback(
    (): RecoveryDeps => ({
      loadTranscript: (sessionId, limit) =>
        getChatMessages(convex!, { sessionId, limit }),
      wait,
      isStale: (generation) => generation !== chatGenerationRef.current,
    }),
    [convex],
  );

  async function recoverPersistedAssistantMessage(
    sessionId: string,
    userMessage: string,
    generation = chatGenerationRef.current,
  ) {
    return recoverPersistedAssistantMessageLoop(
      buildRecoveryDeps(),
      sessionId,
      userMessage,
      generation,
    );
  }

  async function reconcilePersistedAssistantMessage(
    sessionId: string,
    userMessage: string,
    placeholderMessage: string,
    action?: ChatActionHint | null,
    generation = chatGenerationRef.current,
  ) {
    return reconcilePersistedAssistantMessageLoop(
      buildRecoveryDeps(),
      {
        applyRecoveredMessage: (recoveredMessage) => {
          setMessages((items) => {
            const next = [...items];
            for (let index = next.length - 1; index >= 0; index -= 1) {
              if (
                next[index]?.role === "assistant" &&
                next[index]?.content === placeholderMessage
              ) {
                next[index] = { ...next[index], content: recoveredMessage };
                return next;
              }
            }
            return [...items, createAssistantMessage(recoveredMessage, action)];
          });
          setLatestExchange({
            userMessage,
            assistantMessage: recoveredMessage,
          });
        },
      },
      sessionId,
      userMessage,
      placeholderMessage,
      generation,
    );
  }

  async function sendMessage(inputOrSuggestion: string | ChatSuggestion) {
    const generation = chatGenerationRef.current;
    const text =
      typeof inputOrSuggestion === "string"
        ? inputOrSuggestion
        : inputOrSuggestion.text;
    const clean = text.trim();
    if (!clean || chatInputDisabled) return;
    setInput("");
    setLatestExchange(null);
    setTrackedSuggestionIds(null);
    setMessages((items) => [...items, { role: "user", content: clean }]);

    // Suggestion chips are question-only (ai-context-retirement step 5): a click
    // sends the ordinary question text through the SAME path as typed text. We
    // still track which chip was clicked so the connected server call can mark it
    // and so action cards attach, but there is no canned answer text any more.
    // While staff has the chat, we don't resolve a chip to any local reply.
    const preset = aiPaused
      ? undefined
      : suggestions.find((item) => item.text === clean);
    const selectedActionHint = resolveChatActionHint({
      latestUserMessage: clean,
      activePropertySlug: activePropertySlug || undefined,
      villas,
      clickedSuggestionId: preset?.id,
    });

    if (!convex) {
      // Disconnected demo: no canned policy answers. Booking-intent questions get
      // the local booking prompt; everything else gets the honest noConvex notice.
      // The clicked chip's action hint still drives the booking/tour card so, e.g.,
      // the availability chip shows the booking card without asserting any policy.
      const bookingContext = extractChatBookingContext({
        latestUserMessage: clean,
        latestAssistantMessage: "",
        activePropertySlug: activePropertySlug || undefined,
      });
      const hasBookingReply =
        bookingContext.hasBookingIntent || selectedActionHint === "booking";
      const assistantMessage = hasBookingReply
        ? t(localBookingReplyKey(bookingContext))
        : t("noConvex");
      setMessages((items) => [
        ...items,
        createAssistantMessage(assistantMessage, selectedActionHint),
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
        ...(preset ? { clickedSuggestionId: preset.id } : {}),
      });
      return;
    }

    setIsTyping(true);
    let id: string | null = null;
    try {
      id = await ensureSession({ markOpen: true, generation });
      if (generation !== chatGenerationRef.current) return;
      if (!id) throw new Error("No chat session");
      if (preset) {
        await markChatSuggestionClicked(convex, {
          sessionId: id,
          suggestion: { source: "static", suggestionId: preset.id },
        }).catch(() => null);
        if (generation !== chatGenerationRef.current) return;
      }
      const result = await askConcierge(convex, {
        sessionId: id,
        userMessage: clean,
        propertySlug: activePropertySlug || undefined,
        locale,
        ...(selectedActionHint ? { actionHint: selectedActionHint } : {}),
      });
      if (generation !== chatGenerationRef.current) return;
      // Staff took over: their reply arrives through the transcript watch.
      if (result?.aiPaused) {
        setPausedSessionId(id);
        if (!staffReplyNoticeShownRef.current) {
          staffReplyNoticeShownRef.current = true;
          setMessages((items) => withStaffReplyNotice(items, clean));
        }
        return;
      }
      staffReplyNoticeShownRef.current = false;
      setPausedSessionId(null);
      const response =
        typeof result === "object" && result && "response" in result
          ? String(result.response)
          : t("sent");
      setMessages((items) => [
        ...items,
        createAssistantMessage(response, selectedActionHint),
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage: response,
        ...(preset ? { clickedSuggestionId: preset.id } : {}),
      });
    } catch {
      if (generation !== chatGenerationRef.current) return;
      const recoveredMessage = id
        ? await recoverPersistedAssistantMessage(id, clean, generation)
        : null;
      if (generation !== chatGenerationRef.current) return;
      const assistantMessage = recoveredMessage ?? t("fallback");
      setMessages((items) => [
        ...items,
        createAssistantMessage(assistantMessage, selectedActionHint),
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
      });
      if (!recoveredMessage && id) {
        void reconcilePersistedAssistantMessage(
          id,
          clean,
          assistantMessage,
          selectedActionHint,
          generation,
        );
      }
    } finally {
      if (generation !== chatGenerationRef.current) return;
      setIsTyping(false);
    }
  }

  const continueInAppBrowser = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(CHAT_CONTINUE_IN_APP_PARAM, "1");
    url.searchParams.delete(CHAT_HANDOFF_PARAM);
    setBrowserGateVisible(false);
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [router]);

  const copyBrowserLink = useCallback(async () => {
    if (!browserGateUrl) return;
    try {
      await navigator.clipboard.writeText(browserGateUrl);
      setBrowserGateCopyStatus("copied");
    } catch {
      setBrowserGateCopyStatus("error");
    }
  }, [browserGateUrl]);

  return {
    mode,
    open,
    hydrated,
    mounted,
    title,
    chatHref,
    hideFloatingTriggerOnMobileRoom,
    keyboardLayoutMode,
    chatPanelStyle,
    openChat,
    closeChat,
    restartChat,
    browserGateVisible,
    browserGateUrl,
    browserGateCopyStatus,
    browserGateOpenUrl,
    browserGateTargetBrowser,
    continueInAppBrowser,
    copyBrowserLink,
    messages,
    chatMessagesRef,
    messageActionCards,
    latestAssistantIndex,
    canShowMessageSuggestions,
    visibleSuggestions,
    sendMessage,
    chatInputDisabled,
    isTyping,
    messagesStyle,
    floatingContactActionsVisible,
    floatingContactActionsStyle,
    contactEmail,
    whatsappNumber,
    lineId,
    lineUrl,
    lineQrImage,
    hasLatestActionCard,
    overlayComposerDocked,
    pageComposerDocked,
    chatFooterStyle,
    hideContactDetails,
    hideMainComposer,
    chatFooterRef,
    contactFormRef,
    inputRef,
    contactForm,
    setContactForm,
    contactStatus,
    saveContact,
    input,
    setInput,
    focusFooterInput,
    clearFooterFocusAfterBlur,
    onComposerPointerDown: () => {
      keyboardViewportBaselineRef.current ??=
        getKeyboardViewportBaselineHeight();
    },
  };
}
