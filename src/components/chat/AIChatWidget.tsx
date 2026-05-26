"use client";

import Link from "next/link";
import * as SelectPrimitive from "@radix-ui/react-select";
import { MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
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
import { createPortal } from "react-dom";
import { useOptionalConvex } from "@/lib/react/convex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { ChatBookingCard } from "@/components/chat/ChatBookingCard";
import { useChatPageContext } from "@/components/chat/ChatContext";
import { ContactAppBrandIcon } from "@/components/chat/ContactAppBrandIcon";
import { MessagingButtons } from "@/components/chat/MessagingButtons";
import {
  addChatMessage,
  askConcierge,
  closeChatSession,
  createChatSession,
  getReusableChatSession,
  getChatMessages,
  identifyChatVisitor,
  touchChatSession,
} from "@/lib/react/convex-api";
import {
  selectChatSuggestions,
  type ChatSuggestionCandidate,
  type ChatSuggestionId,
} from "@/lib/chat/suggestions";
import { localizeHref, stripLocalePrefix } from "@/i18n/routing";
import { extractChatBookingContext, getBookingPromptKey, type ChatBookingContext } from "@/lib/chat/booking-intent";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string };
type ContactApp = "whatsapp" | "line";
type ContactForm = { email: string; preferredApp: ContactApp; contactHandle: string };
type ChatSuggestion = ChatSuggestionCandidate & { answer: string };
type ChatExperienceMode = "overlay" | "page";
type FooterFocusScope = "composer" | "contact" | null;
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
};

const VISITOR_ID_STORAGE_KEY = "sv_chat_visitor_id";
const SESSION_ID_STORAGE_KEY = "sv_chat_session_id";
const MESSAGE_CACHE_STORAGE_PREFIX = "sv_chat_messages:";
const LOCAL_MESSAGE_CACHE_ID = "local";
const MESSAGE_CACHE_VERSION = 1;
const MAX_CACHED_MESSAGES = 100;
const CHAT_RETURN_TO_PARAM = "returnTo";
const REUSABLE_CHAT_MESSAGE_LIMIT = 20;
const HEARTBEAT_MS = 30_000;
const contactApps: ContactApp[] = ["whatsapp", "line"];
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

function renderMessage(content: string) {
  return content.split("\n").map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={`${line}-${lineIndex}`}>
        {parts.map((part, partIndex) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={`${part}-${partIndex}`} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span key={`${part}-${partIndex}`}>{part}</span>
          ),
        )}
        {lineIndex < content.split("\n").length - 1 ? <br /> : null}
      </span>
    );
  });
}

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
    browserLanguage: navigator.languages?.join(", ") || navigator.language || undefined,
    screenSize:
      typeof window.screen?.width === "number" && typeof window.screen?.height === "number"
        ? `${window.screen.width}x${window.screen.height}`
        : undefined,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    platform: navigatorWithUserAgentData.userAgentData?.platform || navigator.platform || undefined,
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

function isKeyboardInputElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  return element.matches("input, textarea, [contenteditable='true']");
}

function getFocusedFooterInput(footerNode: HTMLElement | null) {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement;
  if (!footerNode?.contains(activeElement) || !isKeyboardInputElement(activeElement)) {
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

function getMeasuredKeyboardInset({
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
}) {
  if (typeof window === "undefined") return 0;

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

  if (mode !== "page" || !focusedInputIsActive) return realInset;
  if (viewportResizedByKeyboard) return 0;

  const inputBottom = inputNode?.getBoundingClientRect().bottom ?? 0;
  const footerBottom = footerNode?.getBoundingClientRect().bottom ?? 0;
  const requiredLift = Math.max(
    0,
    Math.ceil(Math.max(inputBottom, footerBottom) - visibleViewportBottom + KEYBOARD_SAFE_GAP),
  );
  const overlayFallback = realInset <= MOBILE_KEYBOARD_THRESHOLD && fallbackAllowed;
  const estimatedInset = overlayFallback ? getKeyboardOverlayFallbackInset() : 0;

  return clampKeyboardInset(Math.max(realInset, requiredLift, estimatedInset));
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
    typeof item.content === "string"
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

function readCachedChatMessages(sessionId: string | null): ChatMessageCache | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getMessageCacheStorageKey(sessionId));
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
    latestExchange: latestExchange ?? latestExchangeFromMessages(cachedMessages),
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(getMessageCacheStorageKey(sessionId), JSON.stringify(cache));
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

function normalizeTranscriptMessages(transcript: { role: "user" | "assistant"; content: string }[]) {
  return transcript.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function latestExchangeFromMessages(items: Message[]): LatestExchange | null {
  for (let assistantIndex = items.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
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

function localBookingReplyKey(context: ChatBookingContext) {
  return getBookingPromptKey(context);
}

function getSafeChatReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (stripLocalePrefix(url.pathname) === "/chat") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function SuggestionChips({
  suggestions,
  onSelect,
  disabled = false,
}: {
  suggestions: ChatSuggestion[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  if (!suggestions.length) return null;

  return (
    <div data-testid="chat-suggestions" className="mt-2 flex flex-wrap gap-2">
      {suggestions.map((item) => (
        <button
          key={item.id}
          type="button"
          data-suggestion-id={item.id}
          disabled={disabled}
          onClick={() => {
            if (!disabled) onSelect(item.text);
          }}
          className="rounded-full border border-border bg-background/85 px-3 py-1.5 text-left text-[11px] font-medium leading-tight text-slate-700 shadow-sm shadow-black/5 transition hover:border-gold/60 hover:bg-gold/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 dark:border-white/15 dark:bg-background/60 dark:text-slate-300 dark:hover:text-white"
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}

function ContactAppIcon({ app }: { app: ContactApp }) {
  return (
    <ContactAppBrandIcon
      app={app}
      className="h-5 w-5"
      data-testid={`contact-app-icon-${app}`}
    />
  );
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-2xl bg-muted px-3 py-2 text-slate-700 dark:text-slate-200"
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-2 w-2 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${index * 140}ms` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ChatExperience({
  contactEmail,
  mode,
  propertySlug,
  propertyName,
  whatsappNumber,
  lineId,
}: {
  mode: ChatExperienceMode;
  propertySlug?: string;
  propertyName?: string;
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
}) {
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
  const [latestExchange, setLatestExchange] = useState<LatestExchange | null>(null);
  const [contactForm, setContactForm] = useState<ContactForm>({
    email: "",
    preferredApp: "whatsapp",
    contactHandle: "",
  });
  const [contactStatus, setContactStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [footerFocusScope, setFooterFocusScope] = useState<FooterFocusScope>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [chatPageViewportHeight, setChatPageViewportHeight] = useState(CHAT_PAGE_VIEWPORT_FALLBACK);
  const [composerReserveHeight, setComposerReserveHeight] = useState(PAGE_COMPOSER_RESERVE_FALLBACK);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatFooterRef = useRef<HTMLDivElement>(null);
  const contactFormRef = useRef<HTMLFormElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const keyboardInsetRef = useRef(0);
  const keyboardFocusStartedAtRef = useRef(0);
  const keyboardViewportBaselineRef = useRef<number | null>(null);
  const restoredMessageCacheRef = useRef(false);
  const previousPropertySlugRef = useRef(activePropertySlug);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const normalizedPathname = stripLocalePrefix(pathname);
  const currentSearch = searchParams.toString();
  const currentPathWithSearch = currentSearch ? `${pathname}?${currentSearch}` : pathname;
  const returnToParam = searchParams.get(CHAT_RETURN_TO_PARAM);

  const title = activePropertyName
    ? t("propertyTitle", { propertyName: activePropertyName })
    : t("defaultTitle");
  const suggestions = useMemo(
    (): ChatSuggestion[] => [
      {
        id: "couple",
        text: t("suggestionCouple"),
        answer: t("answerCouple"),
      },
      {
        id: "direct",
        text: t("suggestionDirect"),
        answer: t("answerDirect"),
      },
      {
        id: "tour",
        text: t("suggestion360"),
        answer: t("answer360"),
      },
    ],
    [t],
  );
  const visibleSuggestions = useMemo(
    () =>
      selectChatSuggestions({
        candidates: suggestions,
        activePropertySlug: activePropertySlug || undefined,
        latestUserMessage: latestExchange?.userMessage,
        latestAssistantMessage: latestExchange?.assistantMessage,
        clickedSuggestionId: latestExchange?.clickedSuggestionId,
      }) as ChatSuggestion[],
    [activePropertySlug, latestExchange, suggestions],
  );
  const latestAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") return index;
    }
    return -1;
  }, [messages]);
  const latestBookingContext = useMemo(
    () =>
      latestExchange
        ? extractChatBookingContext({
            latestUserMessage: latestExchange.userMessage,
            latestAssistantMessage: latestExchange.assistantMessage,
            activePropertySlug: activePropertySlug || undefined,
          })
        : null,
    [activePropertySlug, latestExchange],
  );
  const canShowMessageSuggestions =
    !isTyping && latestAssistantIndex >= 0 && latestAssistantIndex === messages.length - 1;
  const canShowBookingCard =
    canShowMessageSuggestions && Boolean(latestBookingContext?.hasBookingIntent);
  const chatInputDisabled =
    !messageCacheReady ||
    isTyping ||
    (Boolean(convex) && !sessionReady && messages.length === 0) ||
    (isHydratingSession && messages.length === 0);
  const hideFloatingTriggerOnMobileRoom = normalizedPathname.startsWith("/rooms/");
  const chatHref = useMemo(() => {
    const params = new URLSearchParams();
    if (activePropertySlug) params.set("property", activePropertySlug);
    if (normalizedPathname !== "/chat") {
      params.set(CHAT_RETURN_TO_PARAM, currentPathWithSearch);
    }
    const query = params.toString();
    return localizeHref(`/chat${query ? `?${query}` : ""}`, locale);
  }, [activePropertySlug, currentPathWithSearch, locale, normalizedPathname]);
  const shouldLockScroll =
    mode === "overlay" &&
    open &&
    typeof window !== "undefined" &&
    !window.matchMedia("(min-width: 768px)").matches;
  const keyboardInsetActive = mobileKeyboardInset > MOBILE_KEYBOARD_THRESHOLD;
  const contactFocused = footerFocusScope === "contact";
  const mobileKeyboardActive =
    isMobileViewport && (footerFocusScope !== null || keyboardInsetActive);
  const hideAuxiliaryControls = mobileKeyboardActive;
  const hideContactDetails = mobileKeyboardActive && !contactFocused;
  const hideMainComposer = isMobileViewport && contactFocused;
  const overlayComposerDocked =
    mode === "overlay" && mobileKeyboardActive && keyboardInsetActive;
  const pageComposerDocked = mode === "page" && mobileKeyboardActive;
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
  const chatFooterStyle =
    overlayComposerDocked
      ? {
          bottom: mobileKeyboardInset,
          left: 0,
          position: "fixed" as const,
          right: 0,
          zIndex: 60,
        }
      : pageComposerDocked
        ? {
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
          } satisfies ChatPanelStyle
      : undefined;
  const messagesStyle =
    overlayComposerDocked
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

    const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
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

      transcriptEndRef.current?.scrollIntoView({ block: "end", behavior });
    },
    [mode],
  );

  const refreshChatPageAfterKeyboardChange = useCallback(() => {
    if (mode !== "page" || typeof window === "undefined") return;

    updateChatPageViewportHeight();
    scrollTranscriptToEnd();
    KEYBOARD_PROBE_DELAYS_MS.forEach((delay) => {
      window.setTimeout(() => {
        updateChatPageViewportHeight();
        scrollTranscriptToEnd();
      }, delay);
    });
  }, [mode, scrollTranscriptToEnd, updateChatPageViewportHeight]);

  const focusFooterInput = useCallback(
    (scope: Exclude<FooterFocusScope, null>) => {
      keyboardFocusStartedAtRef.current = Date.now();
      keyboardViewportBaselineRef.current ??= getKeyboardViewportBaselineHeight();
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
        cachedTranscript.latestExchange ?? latestExchangeFromMessages(cachedTranscript.messages),
      );
    }

    setMessageCacheReady(true);
  }, []);

  useEffect(() => {
    if (!messageCacheReady) return;
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
  }, [activePropertySlug]);

  const createFreshSession = useCallback(async () => {
    if (!convex) return null;
    const id = await createChatSession(convex, {
      propertySlug: activePropertySlug || undefined,
      channel: "web",
      visitorId: getOrCreateVisitorId(),
      ...getBrowserChatMetadata(),
    });
    setStoredSessionId(id);
    setSessionId(id);
    return id;
  }, [activePropertySlug, convex]);

  const hydrateExistingSession = useCallback(
    async (id: string, markOpen = false, hydrateMessages = true) => {
      if (!convex) return null;
      await touchChatSession(convex, {
        sessionId: id,
        propertySlug: activePropertySlug || undefined,
        ...getBrowserChatMetadata(),
        isOpen: markOpen,
      });

      setStoredSessionId(id);
      setSessionId(id);

      if (!hydrateMessages) {
        return id;
      }

      const transcript = await getChatMessages(convex, {
        sessionId: id,
        limit: REUSABLE_CHAT_MESSAGE_LIMIT,
      });
      if (transcript.length >= REUSABLE_CHAT_MESSAGE_LIMIT) {
        throw new Error("Chat session has reached the reusable message limit.");
      }

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
    }: EnsureSessionOptions = {}) => {
      if (!convex) return null;
      if (sessionId) {
        if (validateForReuse) {
          try {
            await hydrateExistingSession(sessionId, markOpen, hydrateMessages);
            return sessionId;
          } catch {
            clearStoredSessionId();
            clearCachedChatMessages(sessionId);
            setSessionId(null);
            if (hydrateMessages && !restoredMessageCacheRef.current) {
              setMessages([]);
              setLatestExchange(null);
            }
            return await createFreshSession();
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
        return sessionId;
      }

      const storedId = getStoredSessionId();
      if (storedId) {
        try {
          await hydrateExistingSession(storedId, markOpen, hydrateMessages);
          return storedId;
        } catch {
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
            );
          }
        } catch {
          // If lookup fails, create a clean session so chat stays available.
        }
      }

      return await createFreshSession();
    },
    [activePropertySlug, convex, createFreshSession, hydrateExistingSession, sessionId],
  );

  const primeSessionForOpen = useCallback(async () => {
    if (!convex || !messageCacheReady) {
      setSessionReady(true);
      return;
    }

    const shouldHydrateMessages = !restoredMessageCacheRef.current && messages.length === 0;
    setIsHydratingSession(true);
    try {
      await ensureSession({
        markOpen: true,
        validateForReuse: true,
        hydrateMessages: shouldHydrateMessages,
      });
    } catch {
      // Chat can still operate from the local transcript if the session touch fails.
    } finally {
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
    clearKnownChatMessageCaches(previousSessionId);
    clearStoredSessionId();
    restoredMessageCacheRef.current = false;
    setSessionReady(false);
    setIsHydratingSession(false);

    if (!convex) {
      setSessionId(null);
      setMessages([]);
      setLatestExchange(null);
      setInput("");
      setIsTyping(false);
      setContactStatus("idle");
      setSessionReady(true);
      setOpen(true);
      return;
    }

    try {
      const id = await createFreshSession();
      if (!id) throw new Error("No chat session");
      setMessages([]);
      setLatestExchange(null);
      setInput("");
      setIsTyping(false);
      setContactStatus("idle");
      setSessionReady(true);
      setOpen(true);
    } catch {
      setSessionReady(true);
      setContactStatus("error");
    }
  }, [convex, createFreshSession, sessionId]);

  const closeChat = useCallback(() => {
    if (mode === "page") {
      if (convex && sessionId) {
        void closeChatSession(convex, { sessionId }).catch(() => undefined);
      }
      router.push(getSafeChatReturnTo(returnToParam) ?? localizeHref("/", locale));
      return;
    }

    setOpen(false);
    if (convex && sessionId) {
      void closeChatSession(convex, { sessionId }).catch(() => undefined);
    }
  }, [convex, locale, mode, returnToParam, router, sessionId]);

  useEffect(() => {
    if (mode !== "page") return;
    if (!open || !messageCacheReady || sessionReady || isHydratingSession) return;
    void primeSessionForOpen();
  }, [
    isHydratingSession,
    messageCacheReady,
    mode,
    open,
    primeSessionForOpen,
    sessionReady,
  ]);

  useEffect(() => {
    if (mode === "page") return;

    function openFromStickyBar() {
      openChat();
    }

    window.addEventListener("open-concierge-chat", openFromStickyBar);
    return () => window.removeEventListener("open-concierge-chat", openFromStickyBar);
  }, [mode, openChat]);

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
        keyboardViewportBaselineRef.current ??= getKeyboardViewportBaselineHeight();
      } else {
        keyboardViewportBaselineRef.current = null;
      }
      const fallbackAllowed = isKeyboardOverlayBrowser();
      const effectiveInset = getMeasuredKeyboardInset({
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
        effectiveInset !== 0
      ) {
        return;
      }

      keyboardInsetRef.current = effectiveInset;
      setMobileKeyboardInset(effectiveInset);
      if (effectiveInset <= MOBILE_KEYBOARD_THRESHOLD && !focusedInputIsActive) {
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
    window.visualViewport?.addEventListener("resize", scheduleKeyboardInsetUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleKeyboardInsetUpdate);
    window.addEventListener("resize", scheduleKeyboardInsetUpdate);
    window.addEventListener("orientationchange", scheduleKeyboardInsetUpdate);
    mobileQuery.addEventListener("change", scheduleKeyboardInsetUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      window.visualViewport?.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleKeyboardInsetUpdate);
      window.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      window.removeEventListener("orientationchange", scheduleKeyboardInsetUpdate);
      mobileQuery.removeEventListener("change", scheduleKeyboardInsetUpdate);
    };
  }, [footerFocusScope, mode, open, updateChatPageViewportHeight]);

  useEffect(() => {
    const node = chatFooterRef.current;
    if (!node) return;
    const footerNode = node;

    function updateComposerReserve() {
      setComposerReserveHeight(Math.ceil(footerNode.getBoundingClientRect().height));
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
    scrollTranscriptToEnd();
  }, [canShowBookingCard, messages.length, open, scrollTranscriptToEnd]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && window.matchMedia("(min-width: 768px)").matches) {
        closeChat();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeChat, open]);

  useEffect(() => {
    if (!open || !convex) return;
    const interval = window.setInterval(() => {
      void ensureSession({ markOpen: true });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [convex, ensureSession, open]);

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
        phone: contactForm.preferredApp === "whatsapp" ? contactForm.contactHandle || undefined : undefined,
        contactApp: contactForm.preferredApp,
        contactHandle: contactForm.contactHandle || undefined,
      });
      setContactStatus("saved");
    } catch {
      setContactStatus("error");
    }
  }

  async function recoverPersistedAssistantMessage(sessionId: string, userMessage: string) {
    for (let attempt = 0; attempt < TRANSCRIPT_RECOVERY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await wait(TRANSCRIPT_RECOVERY_DELAY_MS);

      try {
        const transcript = await getChatMessages(convex!, { sessionId, limit: 25 });
        const matchingUserIndex = transcript.findLastIndex(
          (message) => message.role === "user" && message.content.trim() === userMessage,
        );
        const assistantAfterUser =
          matchingUserIndex >= 0
            ? transcript.slice(matchingUserIndex + 1).find((message) => message.role === "assistant")
            : undefined;

        if (assistantAfterUser?.content.trim()) return assistantAfterUser.content;
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
  ) {
    for (let attempt = 0; attempt < BACKGROUND_RECONCILE_ATTEMPTS; attempt += 1) {
      await wait(BACKGROUND_RECONCILE_DELAY_MS);
      const recoveredMessage = await recoverPersistedAssistantMessage(sessionId, userMessage);
      if (!recoveredMessage || recoveredMessage === placeholderMessage) continue;

      setMessages((items) => {
        const next = [...items];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index]?.role === "assistant" && next[index]?.content === placeholderMessage) {
            next[index] = { role: "assistant", content: recoveredMessage };
            return next;
          }
        }
        return [...items, { role: "assistant", content: recoveredMessage }];
      });
      setLatestExchange({
        userMessage,
        assistantMessage: recoveredMessage,
      });
      return;
    }
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || chatInputDisabled) return;
    setInput("");
    setLatestExchange(null);
    setMessages((items) => [...items, { role: "user", content: clean }]);

    const preset = suggestions.find((item) => item.text === clean);
    if (preset) {
      const assistantMessage = preset.answer;
      setMessages((items) => [...items, { role: "assistant", content: assistantMessage }]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
        clickedSuggestionId: preset.id,
      });
      if (convex) {
        try {
          const id = await ensureSession({ markOpen: true });
          if (id) {
            await addChatMessage(convex, { sessionId: id, role: "user", content: clean });
            await addChatMessage(convex, {
              sessionId: id,
              role: "assistant",
              content: preset.answer,
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
        {
          role: "assistant",
          content: assistantMessage,
        },
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
      id = await ensureSession({ markOpen: true });
      if (!id) throw new Error("No chat session");
      const result = await askConcierge(convex, {
        sessionId: id,
        userMessage: clean,
        propertySlug: activePropertySlug || undefined,
        locale,
      });
      const response =
        typeof result === "object" && result && "response" in result
          ? String(result.response)
          : t("sent");
      setMessages((items) => [...items, { role: "assistant", content: response }]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage: response,
      });
    } catch {
      const recoveredMessage = id ? await recoverPersistedAssistantMessage(id, clean) : null;
      const assistantMessage = recoveredMessage ?? t("fallback");
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          content: assistantMessage,
        },
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
      });
      if (!recoveredMessage && id) {
        void reconcilePersistedAssistantMessage(id, clean, assistantMessage);
      }
    } finally {
      setIsTyping(false);
    }
  }

  const panel = (
    <div
      data-testid="chat-panel"
      className={cn(
        mode === "overlay"
          ? "pointer-events-auto fixed inset-0 flex h-[100dvh] flex-col overflow-hidden border-border bg-card shadow-2xl transition duration-300 ease-out motion-reduce:transition-none md:inset-auto md:bottom-5 md:right-5 md:h-[78vh] md:max-h-[820px] md:w-[640px] md:max-w-[calc(100vw-2.5rem)] md:origin-bottom-right md:rounded-2xl md:border"
          : "relative mx-auto flex w-full max-w-3xl flex-col overflow-hidden bg-card",
        mode === "overlay" &&
          (open
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-8 scale-[0.98] opacity-0 md:translate-y-3 md:scale-95"),
      )}
      style={chatPanelStyle}
    >
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-4 py-2.5 text-white md:px-4 md:py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-gold" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={restartChat}
                className="h-8 rounded-full px-2 text-sm font-semibold text-white hover:bg-white/10 hover:text-white"
                aria-label={`${t("restartChat")} - ${title}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{t("restartChat")}</span>
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeChat}
              className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={t("close")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div
            data-testid="chat-messages"
            ref={chatMessagesRef}
            className={cn(
              "min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 md:px-4 md:py-4",
              mode === "page" && "overscroll-contain pb-6",
            )}
            style={messagesStyle}
          >
            {messages.length === 0 ? (
              <div className="max-w-[92%]">
                <div className="rounded-2xl bg-muted p-4 text-base leading-relaxed text-slate-700 dark:text-slate-200 md:p-3 md:text-sm">
                  {t("intro")}
                </div>
                {!isTyping ? (
                  <SuggestionChips
                    suggestions={visibleSuggestions}
                    onSelect={sendMessage}
                    disabled={chatInputDisabled}
                  />
                ) : null}
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  "max-w-[85%]",
                  message.role === "assistant" &&
                    index === latestAssistantIndex &&
                    canShowBookingCard &&
                    latestBookingContext &&
                    "w-full max-w-[96%] md:max-w-[85%]",
                  message.role === "user" ? "ml-auto" : "mr-auto",
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {renderMessage(message.content)}
                </div>
                {message.role === "assistant" &&
                index === latestAssistantIndex &&
                canShowBookingCard &&
                latestBookingContext ? (
                  <ChatBookingCard context={latestBookingContext} />
                ) : null}
                {message.role === "assistant" &&
                index === latestAssistantIndex &&
                canShowMessageSuggestions &&
                !canShowBookingCard ? (
                  <SuggestionChips
                    suggestions={visibleSuggestions}
                    onSelect={sendMessage}
                    disabled={chatInputDisabled}
                  />
                ) : null}
              </div>
            ))}
            {isTyping ? (
              <TypingIndicator label={t("thinking")} />
            ) : null}
            <div ref={transcriptEndRef} />
          </div>

          {floatingContactActionsVisible ? (
            <div
              data-testid="floating-contact-actions"
              className="absolute left-4 z-20 md:left-3"
              style={floatingContactActionsStyle}
            >
              <MessagingButtons
                contactEmail={contactEmail}
                whatsappNumber={whatsappNumber}
                lineId={lineId}
                quiet={canShowBookingCard}
              />
            </div>
          ) : null}

          <div
            data-testid="chat-footer"
            ref={chatFooterRef}
            className={cn(
              "shrink-0 space-y-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:px-3 md:py-3",
              mode === "page" && "pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]",
              mode === "overlay" &&
                overlayComposerDocked &&
                "shadow-[0_-18px_40px_rgba(0,0,0,0.22)] md:shadow-none",
              pageComposerDocked &&
                "inset-x-0 mx-auto w-full max-w-3xl shadow-[0_-18px_40px_rgba(0,0,0,0.22)]",
            )}
            style={chatFooterStyle}
          >
            <details
              className={cn(
                "rounded-xl border border-border bg-background/70 px-3 py-2 text-sm",
                hideContactDetails && "hidden md:block",
              )}
            >
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-300">
                {t("shareContact")}
              </summary>
              <form
                ref={contactFormRef}
                className="mt-3 grid gap-2"
                onFocusCapture={() => focusFooterInput("contact")}
                onBlurCapture={clearFooterFocusAfterBlur}
                onSubmit={saveContact}
              >
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    value={contactForm.email}
                    onChange={(event) =>
                      setContactForm((current) => ({ ...current, email: event.target.value }))
                    }
                    className="h-9 rounded-lg text-sm"
                    placeholder={t("email")}
                    type="email"
                    aria-label={t("email")}
                  />
                  <div
                    data-testid="contact-app-field"
                    className="flex h-9 min-w-0 items-center overflow-hidden rounded-lg border border-input bg-background shadow-sm transition focus-within:ring-3 focus-within:ring-ring/40"
                  >
                    <Select
                      value={contactForm.preferredApp}
                      onValueChange={(value) =>
                        setContactForm((current) => ({
                          ...current,
                          preferredApp: value as ContactApp,
                          contactHandle: "",
                        }))
                      }
                    >
                      <SelectPrimitive.Trigger
                        aria-label={t("preferredApp")}
                        className="inline-flex h-full w-12 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-foreground transition focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                      >
                        <ContactAppIcon app={contactForm.preferredApp} />
                      </SelectPrimitive.Trigger>
                      <SelectContent>
                        {contactApps.map((app) => (
                          <SelectItem key={app} value={app}>
                            <span
                              data-testid={`contact-app-option-${app}`}
                              className="inline-flex min-w-0 items-center gap-2"
                            >
                              <ContactAppIcon app={app} />
                              <span className="truncate">{t(app)}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="h-5 w-px shrink-0 bg-border" />
                    <Input
                      value={contactForm.contactHandle}
                      onChange={(event) =>
                        setContactForm((current) => ({ ...current, contactHandle: event.target.value }))
                      }
                      className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-sm shadow-none focus-visible:ring-0"
                      placeholder={
                        contactForm.preferredApp === "whatsapp"
                          ? t("whatsappPlaceholder")
                          : t("linePlaceholder")
                      }
                      aria-label={t("contactHandle")}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-700 dark:text-slate-300">
                    {contactStatus === "saved"
                      ? t("saved")
                      : contactStatus === "error"
                        ? t("error")
                        : t("optional")}
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={contactStatus === "saving"}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    {contactStatus === "saving" ? t("saving") : t("save")}
                  </Button>
                </div>
              </form>
            </details>
            <form
              className={cn("flex gap-2", hideMainComposer && "hidden md:flex")}
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPointerDown={() => {
                  keyboardViewportBaselineRef.current ??= getKeyboardViewportBaselineHeight();
                }}
                onFocus={() => {
                  focusFooterInput("composer");
                }}
                onBlur={clearFooterFocusAfterBlur}
                className="h-12 min-w-0 flex-1 rounded-2xl border-muted bg-muted/70 px-4 text-base placeholder:text-slate-500 focus-visible:ring-2 dark:placeholder:text-slate-400 md:h-10 md:rounded-lg md:bg-background md:px-3 md:text-sm"
                placeholder={t("askPlaceholder")}
                enterKeyHint="send"
              />
              <Button
                type="submit"
                size="icon"
                disabled={chatInputDisabled}
                aria-label={t("send")}
                className="h-12 w-12 shrink-0 rounded-2xl md:h-10 md:w-10 md:rounded-lg"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
    </div>
  );

  if (mode === "page") {
    return panel;
  }

  return (
    <>
      {hydrated ? (
        <>
          {!hideFloatingTriggerOnMobileRoom ? (
            <Link
              href={chatHref}
              onClick={(event) => {
                event.preventDefault();
                router.push(chatHref);
              }}
              className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105 md:hidden"
              aria-label={t("open")}
            >
              <MessageCircle className="h-6 w-6" />
            </Link>
          ) : null}
          <button
            type="button"
            onClick={openChat}
            className={cn(
              "fixed bottom-5 right-5 z-50 hidden h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105 md:flex",
              open && "pointer-events-none opacity-0",
            )}
            aria-label={t("open")}
          >
            <MessageCircle className="h-6 w-6" />
          </button>
        </>
      ) : null}

      {hydrated && mounted ? createPortal((
        <div
          className={cn(
            "fixed inset-0 z-50 bg-background/85 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none md:pointer-events-none md:bg-transparent md:backdrop-blur-0",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          {panel}
        </div>
      ), document.body) : null}
    </>
  );
}

export function AIChatWidget(props: {
  propertySlug?: string;
  propertyName?: string;
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
}) {
  return <ChatExperience {...props} mode="overlay" />;
}

export function AIChatPage(props: {
  propertySlug?: string;
  propertyName?: string;
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
}) {
  return <ChatExperience {...props} mode="page" />;
}
