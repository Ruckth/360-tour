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
import { useChatPageContext } from "@/components/chat/ChatContext";
import type { ContactForm } from "@/components/chat/ChatComposer";
import type {
  ChatMessage as Message,
  ChatSuggestion,
} from "@/components/chat/chat-types";
import {
  addChatMessage,
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

type StaticChatSuggestion = ChatSuggestion;
type ChatExperienceMode = "overlay" | "page";
type FooterFocusScope = "composer" | "contact" | null;
type KeyboardLayoutMode =
  | "none"
  | "resizedViewport"
  | "overlayInset"
  | "overlayFallback";
type LatestExchange = {
  userMessage: string;
  assistantMessage: string;
  clickedSuggestionId?: ChatSuggestionId | null;
};
type ChatMessageCache = {
  version: number;
  sessionId: string | null;
  messages: Message[];
  latestExchange: LatestExchange | null;
  updatedAt: number;
};
type EnsureSessionOptions = {
  markOpen?: boolean;
  validateForReuse?: boolean;
  hydrateMessages?: boolean;
  generation?: number;
};

const VISITOR_ID_STORAGE_KEY = "sv_chat_visitor_id";
const SESSION_ID_STORAGE_KEY = "sv_chat_session_id";
const MESSAGE_CACHE_STORAGE_PREFIX = "sv_chat_messages:";
const LOCAL_MESSAGE_CACHE_ID = "local";
const MESSAGE_CACHE_VERSION = 1;
const MAX_CACHED_MESSAGES = 100;
const REUSABLE_CHAT_MESSAGE_LIMIT = 20;
const VISIBLE_FOLLOW_UP_SUGGESTION_LIMIT = 2;
const HEARTBEAT_MS = 30_000;
const TRANSCRIPT_RECOVERY_ATTEMPTS = 10;
const TRANSCRIPT_RECOVERY_DELAY_MS = 2_000;
const BACKGROUND_RECONCILE_ATTEMPTS = 30;
const BACKGROUND_RECONCILE_DELAY_MS = 2_000;
const MOBILE_KEYBOARD_THRESHOLD = 80;
const CHAT_PAGE_HEADER_OFFSET = 0;
const CHAT_PAGE_MIN_HEIGHT = 360;
const CHAT_PAGE_VIEWPORT_FALLBACK = "100svh";
const PAGE_COMPOSER_RESERVE_FALLBACK = 84;
const IN_APP_KEYBOARD_FALLBACK_RATIO = 0.43;
const IN_APP_KEYBOARD_FALLBACK_MIN = 280;
const IN_APP_KEYBOARD_FALLBACK_MAX = 440;
const KEYBOARD_SAFE_GAP = 16;
const KEYBOARD_INSET_EPSILON = 8;
const KEYBOARD_PROBE_DELAYS_MS = [80, 180, 360, 600] as const;
const KEYBOARD_OVERLAY_BROWSER_PATTERN =
  /Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|TikTok|TwitterAndroid|;\s?wv\)/i;

type ChatPanelStyle = CSSProperties & {
  "--chat-keyboard-inset"?: string;
  "--chat-visible-height"?: string;
};

function getOrCreateVisitorId() {
  if (typeof window === "undefined") return undefined;

  const existing = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, id);
  return id;
}

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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isKeyboardOverlayBrowser() {
  if (typeof navigator === "undefined") return false;
  return KEYBOARD_OVERLAY_BROWSER_PATTERN.test(navigator.userAgent);
}

function getKeyboardOverlayFallbackInset() {
  if (typeof window === "undefined") return 0;
  return Math.min(
    IN_APP_KEYBOARD_FALLBACK_MAX,
    Math.max(
      IN_APP_KEYBOARD_FALLBACK_MIN,
      Math.round(window.innerHeight * IN_APP_KEYBOARD_FALLBACK_RATIO),
    ),
  );
}

function getVisualViewportHeight() {
  if (typeof window === "undefined") return 0;
  return window.visualViewport?.height ?? window.innerHeight;
}

function getKeyboardViewportBaselineHeight() {
  if (typeof window === "undefined") return 0;
  return Math.max(window.innerHeight, getVisualViewportHeight());
}

function isKeyboardInputElement(
  element: Element | null,
): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  return element.matches("input, textarea, [contenteditable='true']");
}

function getFocusedFooterInput(footerNode: HTMLElement | null) {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement;
  if (
    !footerNode?.contains(activeElement) ||
    !isKeyboardInputElement(activeElement)
  ) {
    return null;
  }

  return activeElement;
}

function clampKeyboardInset(inset: number) {
  if (typeof window === "undefined") return inset;
  const maxInset = Math.max(
    IN_APP_KEYBOARD_FALLBACK_MAX,
    Math.round(window.innerHeight * 0.7),
  );
  return Math.min(Math.max(0, Math.ceil(inset)), maxInset);
}

function getKeyboardLayoutMeasurement({
  fallbackAllowed,
  focusedInputIsActive,
  footerNode,
  inputNode,
  mode,
  viewportBaselineHeight,
}: {
  fallbackAllowed: boolean;
  focusedInputIsActive: boolean;
  footerNode: HTMLElement | null;
  inputNode: HTMLElement | null;
  mode: ChatExperienceMode;
  viewportBaselineHeight: number | null;
}): { inset: number; layoutMode: KeyboardLayoutMode } {
  if (typeof window === "undefined") return { inset: 0, layoutMode: "none" };

  const visualViewport = window.visualViewport;
  const visualViewportHeight = getVisualViewportHeight();
  const visibleViewportBottom =
    (visualViewport?.offsetTop ?? 0) + visualViewportHeight;
  const realInset = Math.max(
    0,
    Math.round(window.innerHeight - visibleViewportBottom),
  );
  const viewportShrink = viewportBaselineHeight
    ? Math.max(0, Math.round(viewportBaselineHeight - visualViewportHeight))
    : 0;
  const viewportResizedByKeyboard = viewportShrink > MOBILE_KEYBOARD_THRESHOLD;

  if (!focusedInputIsActive) {
    return realInset > MOBILE_KEYBOARD_THRESHOLD
      ? { inset: clampKeyboardInset(realInset), layoutMode: "overlayInset" }
      : { inset: 0, layoutMode: "none" };
  }

  if (mode === "page" && viewportResizedByKeyboard) {
    return { inset: 0, layoutMode: "resizedViewport" };
  }

  if (mode !== "page") {
    return realInset > MOBILE_KEYBOARD_THRESHOLD
      ? { inset: clampKeyboardInset(realInset), layoutMode: "overlayInset" }
      : { inset: 0, layoutMode: "none" };
  }

  const inputBottom = inputNode?.getBoundingClientRect().bottom ?? 0;
  const footerBottom = footerNode?.getBoundingClientRect().bottom ?? 0;
  const requiredLift = Math.max(
    0,
    Math.ceil(
      Math.max(inputBottom, footerBottom) -
        visibleViewportBottom +
        KEYBOARD_SAFE_GAP,
    ),
  );
  const overlayFallback =
    realInset <= MOBILE_KEYBOARD_THRESHOLD && fallbackAllowed;
  const estimatedInset = overlayFallback
    ? getKeyboardOverlayFallbackInset()
    : 0;
  const inset = clampKeyboardInset(
    Math.max(realInset, requiredLift, estimatedInset),
  );

  if (inset <= MOBILE_KEYBOARD_THRESHOLD)
    return { inset: 0, layoutMode: "none" };
  return {
    inset,
    layoutMode:
      overlayFallback && estimatedInset >= Math.max(realInset, requiredLift)
        ? "overlayFallback"
        : "overlayInset",
  };
}

function getStoredSessionId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
}

function setStoredSessionId(sessionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
}

function clearStoredSessionId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
}

function getMessageCacheStorageKey(sessionId: string | null) {
  return `${MESSAGE_CACHE_STORAGE_PREFIX}${sessionId ?? LOCAL_MESSAGE_CACHE_ID}`;
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Message>;
  return (
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    (item.action === undefined ||
      item.action === "booking" ||
      item.action === "tour" ||
      item.action === "none")
  );
}

function isLatestExchange(value: unknown): value is LatestExchange {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LatestExchange>;
  return (
    typeof item.userMessage === "string" &&
    typeof item.assistantMessage === "string" &&
    (item.clickedSuggestionId === undefined ||
      item.clickedSuggestionId === null ||
      typeof item.clickedSuggestionId === "string")
  );
}

function normalizeCachedMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isMessage).slice(-MAX_CACHED_MESSAGES);
}

function readCachedChatMessages(
  sessionId: string | null,
): ChatMessageCache | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(
      getMessageCacheStorageKey(sessionId),
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ChatMessageCache>;
    if (parsed.version !== MESSAGE_CACHE_VERSION) return null;

    const messages = normalizeCachedMessages(parsed.messages);
    if (!messages.length) return null;

    return {
      version: MESSAGE_CACHE_VERSION,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      messages,
      latestExchange: isLatestExchange(parsed.latestExchange)
        ? parsed.latestExchange
        : latestExchangeFromMessages(messages),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeCachedChatMessages(
  sessionId: string | null,
  messages: Message[],
  latestExchange: LatestExchange | null,
) {
  if (typeof window === "undefined") return;

  const cachedMessages = normalizeCachedMessages(messages);
  if (!cachedMessages.length) return;

  const cache: ChatMessageCache = {
    version: MESSAGE_CACHE_VERSION,
    sessionId,
    messages: cachedMessages,
    latestExchange:
      latestExchange ?? latestExchangeFromMessages(cachedMessages),
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(
    getMessageCacheStorageKey(sessionId),
    JSON.stringify(cache),
  );
  if (sessionId) {
    window.localStorage.removeItem(getMessageCacheStorageKey(null));
  }
}

function clearCachedChatMessages(sessionId: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getMessageCacheStorageKey(sessionId));
}

function clearKnownChatMessageCaches(sessionId: string | null) {
  clearCachedChatMessages(sessionId);
  clearCachedChatMessages(null);
}

function normalizeTranscriptMessages(
  transcript: {
    role: "user" | "assistant";
    content: string;
    action?: ChatActionHint;
  }[],
) {
  return transcript.map((message) =>
    message.role === "assistant" && message.action
      ? createAssistantMessage(message.content, message.action)
      : {
          role: message.role,
          content: message.content,
        },
  );
}

function createAssistantMessage(
  content: string,
  action?: ChatActionHint | null,
): Message {
  return action
    ? { role: "assistant", content, action }
    : { role: "assistant", content };
}

function latestExchangeFromMessages(items: Message[]): LatestExchange | null {
  for (
    let assistantIndex = items.length - 1;
    assistantIndex >= 0;
    assistantIndex -= 1
  ) {
    if (items[assistantIndex]?.role !== "assistant") continue;

    for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
      if (items[userIndex]?.role === "user") {
        return {
          userMessage: items[userIndex].content,
          assistantMessage: items[assistantIndex].content,
        };
      }
    }
  }

  return null;
}

function previousUserMessageFor(items: Message[], assistantIndex: number) {
  for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
    if (items[userIndex]?.role === "user") return items[userIndex].content;
  }

  return "";
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
  const [hydrated, setHydrated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messageCacheReady, setMessageCacheReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
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
        answer: t("answerAvailability"),
        source: "static",
      },
      {
        id: "totalPrice",
        text: t("suggestionTotalPrice"),
        answer: t("answerTotalPrice"),
        source: "static",
      },
      {
        id: "direct",
        text: t("suggestionDirect"),
        answer: t("answerDirect"),
        source: "static",
      },
      {
        id: "tour",
        text: t("suggestion360"),
        answer: t("answer360"),
        source: "static",
      },
      {
        id: "guests",
        text: t("suggestionGuests"),
        answer: t("answerGuests"),
        source: "static",
      },
      {
        id: "contact",
        text: t("suggestionContact"),
        answer: t("answerContact"),
        source: "static",
      },
      {
        id: "couple",
        text: t("suggestionCouple"),
        answer: t("answerCouple"),
        source: "static",
      },
      {
        id: "family",
        text: t("suggestionFamily"),
        answer: t("answerFamily"),
        source: "static",
      },
      {
        id: "cancellation",
        text: t("suggestionCancellation"),
        answer: t("answerCancellation"),
        source: "static",
      },
      {
        id: "airport",
        text: t("suggestionAirport"),
        answer: t("answerAirport"),
        source: "static",
      },
      {
        id: "amenitiesIncluded",
        text: t("suggestionAmenitiesIncluded"),
        answer: t("answerAmenitiesIncluded"),
        source: "static",
      },
      {
        id: "location",
        text: t("suggestionLocation"),
        answer: t("answerLocation"),
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
          actionHint: message.action,
          clickedSuggestionId,
        });
      }),
    [
      activePropertySlug,
      latestAssistantIndex,
      latestExchange?.clickedSuggestionId,
      messages,
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

  useEffect(() => {
    if (!open || !convex || browserGateVisible) return;
    const interval = window.setInterval(() => {
      void ensureSession({ markOpen: true });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [browserGateVisible, convex, ensureSession, open]);

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

  async function recoverPersistedAssistantMessage(
    sessionId: string,
    userMessage: string,
    generation = chatGenerationRef.current,
  ) {
    for (
      let attempt = 0;
      attempt < TRANSCRIPT_RECOVERY_ATTEMPTS;
      attempt += 1
    ) {
      if (generation !== chatGenerationRef.current) return null;
      if (attempt > 0) await wait(TRANSCRIPT_RECOVERY_DELAY_MS);
      if (generation !== chatGenerationRef.current) return null;

      try {
        const transcript = await getChatMessages(convex!, {
          sessionId,
          limit: 25,
        });
        if (generation !== chatGenerationRef.current) return null;
        const matchingUserIndex = transcript.findLastIndex(
          (message) =>
            message.role === "user" && message.content.trim() === userMessage,
        );
        const assistantAfterUser =
          matchingUserIndex >= 0
            ? transcript
                .slice(matchingUserIndex + 1)
                .find((message) => message.role === "assistant")
            : undefined;

        if (assistantAfterUser?.content.trim())
          return assistantAfterUser.content;
      } catch {
        // Keep trying briefly before falling back locally.
      }
    }

    return null;
  }

  async function reconcilePersistedAssistantMessage(
    sessionId: string,
    userMessage: string,
    placeholderMessage: string,
    action?: ChatActionHint | null,
    generation = chatGenerationRef.current,
  ) {
    for (
      let attempt = 0;
      attempt < BACKGROUND_RECONCILE_ATTEMPTS;
      attempt += 1
    ) {
      await wait(BACKGROUND_RECONCILE_DELAY_MS);
      if (generation !== chatGenerationRef.current) return;
      const recoveredMessage = await recoverPersistedAssistantMessage(
        sessionId,
        userMessage,
        generation,
      );
      if (!recoveredMessage || recoveredMessage === placeholderMessage)
        continue;
      if (generation !== chatGenerationRef.current) return;

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
      return;
    }
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

    const preset = suggestions.find((item) => item.text === clean);
    const selectedActionHint = resolveChatActionHint({
      latestUserMessage: clean,
      activePropertySlug: activePropertySlug || undefined,
      clickedSuggestionId: preset?.id,
    });
    if (preset) {
      const assistantMessage = preset.answer;
      setMessages((items) => [
        ...items,
        createAssistantMessage(assistantMessage, selectedActionHint),
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
        clickedSuggestionId: preset.id,
      });
      if (convex) {
        try {
          const id = await ensureSession({ markOpen: true, generation });
          if (generation !== chatGenerationRef.current) return;
          if (id) {
            await markChatSuggestionClicked(convex, {
              sessionId: id,
              suggestion: {
                source: "static",
                suggestionId: preset.id,
              },
            }).catch(() => null);
            if (generation !== chatGenerationRef.current) return;
            await addChatMessage(convex, {
              sessionId: id,
              role: "user",
              content: clean,
            });
            if (generation !== chatGenerationRef.current) return;
            await addChatMessage(convex, {
              sessionId: id,
              role: "assistant",
              content: preset.answer,
              ...(selectedActionHint ? { action: selectedActionHint } : {}),
            });
          }
        } catch {
          // The visitor still sees the local answer if persistence is temporarily unavailable.
        }
      }
      return;
    }

    if (!convex) {
      const bookingContext = extractChatBookingContext({
        latestUserMessage: clean,
        latestAssistantMessage: "",
        activePropertySlug: activePropertySlug || undefined,
      });
      const assistantMessage = bookingContext.hasBookingIntent
        ? t(localBookingReplyKey(bookingContext))
        : t("noConvex");
      setMessages((items) => [
        ...items,
        createAssistantMessage(
          assistantMessage,
          bookingContext.hasBookingIntent ? "booking" : null,
        ),
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
      });
      return;
    }

    setIsTyping(true);
    let id: string | null = null;
    try {
      id = await ensureSession({ markOpen: true, generation });
      if (generation !== chatGenerationRef.current) return;
      if (!id) throw new Error("No chat session");
      const result = await askConcierge(convex, {
        sessionId: id,
        userMessage: clean,
        propertySlug: activePropertySlug || undefined,
        locale,
        ...(selectedActionHint ? { actionHint: selectedActionHint } : {}),
      });
      if (generation !== chatGenerationRef.current) return;
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
