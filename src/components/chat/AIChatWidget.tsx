"use client";

import Link from "next/link";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckCircle2, Copy, ExternalLink, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
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
import { ChatVillaTourCard } from "@/components/chat/ChatVillaTourCard";
import { ContactAppBrandIcon } from "@/components/chat/ContactAppBrandIcon";
import { MessagingButtons } from "@/components/chat/MessagingButtons";
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
  type RankedChatSuggestion,
} from "@/lib/react/convex-api";
import {
  selectChatSuggestions,
  type ChatSuggestionCandidate,
  type ChatSuggestionId,
} from "@/lib/chat/suggestions";
import {
  getChatActionCard,
  resolveChatActionHint,
  type ChatActionCard,
  type ChatActionHint,
} from "@/lib/chat/action-card";
import { localizeHref, stripLocalePrefix } from "@/i18n/routing";
import { extractChatBookingContext, getBookingPromptKey, type ChatBookingContext } from "@/lib/chat/booking-intent";
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
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string; action?: ChatActionHint };
type ContactApp = "whatsapp" | "line";
type ContactForm = { email: string; preferredApp: ContactApp; contactHandle: string };
type StaticChatSuggestion = ChatSuggestionCandidate & { answer: string; source: "static" };
type RankedVisibleSuggestion = {
  id: string;
  text: string;
  source: "ranked";
  suggestionSource: RankedChatSuggestion["source"];
  suggestionId: RankedChatSuggestion["suggestionId"];
  answer?: string;
  answerMode?: RankedChatSuggestion["answerMode"];
  dynamicIntent?: RankedChatSuggestion["dynamicIntent"];
  topic: string;
  score: number;
};
type ChatSuggestion = StaticChatSuggestion | RankedVisibleSuggestion;
type ChatExperienceMode = "overlay" | "page";
type FooterFocusScope = "composer" | "contact" | null;
type KeyboardLayoutMode = "none" | "resizedViewport" | "overlayInset" | "overlayFallback";
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
    Math.ceil(Math.max(inputBottom, footerBottom) - visibleViewportBottom + KEYBOARD_SAFE_GAP),
  );
  const overlayFallback = realInset <= MOBILE_KEYBOARD_THRESHOLD && fallbackAllowed;
  const estimatedInset = overlayFallback ? getKeyboardOverlayFallbackInset() : 0;
  const inset = clampKeyboardInset(Math.max(realInset, requiredLift, estimatedInset));

  if (inset <= MOBILE_KEYBOARD_THRESHOLD) return { inset: 0, layoutMode: "none" };
  return {
    inset,
    layoutMode: overlayFallback && estimatedInset >= Math.max(realInset, requiredLift)
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

function normalizeTranscriptMessages(
  transcript: { role: "user" | "assistant"; content: string; action?: ChatActionHint }[],
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

function createAssistantMessage(content: string, action?: ChatActionHint | null): Message {
  return action ? { role: "assistant", content, action } : { role: "assistant", content };
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

function previousUserMessageFor(items: Message[], assistantIndex: number) {
  for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
    if (items[userIndex]?.role === "user") return items[userIndex].content;
  }

  return "";
}

function localBookingReplyKey(context: ChatBookingContext) {
  return getBookingPromptKey(context);
}

function SuggestionChips({
  suggestions,
  onSelect,
  disabled = false,
  variant = "compact",
}: {
  suggestions: ChatSuggestion[];
  onSelect: (suggestion: ChatSuggestion) => void;
  disabled?: boolean;
  variant?: "compact" | "initial";
}) {
  if (!suggestions.length) return null;

  return (
    <div
      data-testid="chat-suggestions"
      className={cn(
        "mt-2 flex flex-wrap",
        variant === "initial" ? "justify-center gap-3" : "gap-2",
      )}
    >
      {suggestions.map((item) => (
        <button
          key={item.id}
          type="button"
          data-suggestion-id={item.id}
          disabled={disabled}
          onClick={() => {
            if (!disabled) onSelect(item);
          }}
          className={cn(
            "max-w-full rounded-full border border-border bg-background/85 font-medium text-slate-700 shadow-sm shadow-black/5 transition hover:border-gold/60 hover:bg-gold/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 dark:border-white/15 dark:bg-background/60 dark:text-slate-300 dark:hover:text-white",
            variant === "initial"
              ? "min-h-11 px-4 py-2.5 text-center text-sm leading-snug sm:px-5 sm:text-[15px]"
              : "px-3 py-1.5 text-left text-[11px] leading-tight",
          )}
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

function ChatBrowserGate({
  browserUrl,
  copyStatus,
  externalOpenUrl,
  targetBrowser,
  onContinue,
  onCopy,
}: {
  browserUrl: string | null;
  copyStatus: "idle" | "copied" | "error";
  externalOpenUrl: string | null;
  targetBrowser: ExternalBrowserTarget["browser"];
  onContinue: () => void;
  onCopy: () => void;
}) {
  const t = useTranslations("Chat");
  const isSafariTarget = targetBrowser === "safari";

  return (
    <div className="min-h-[100svh] bg-background px-5 py-8 text-foreground">
      <div
        data-testid="chat-browser-gate"
        className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md flex-col justify-center"
      >
        <div className="rounded-lg border border-border bg-card p-5 shadow-xl shadow-black/10">
          <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-gold text-navy">
            <ExternalLink className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t(isSafariTarget ? "browserGateTitleSafari" : "browserGateTitle")}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
            {t(isSafariTarget ? "browserGateDescriptionSafari" : "browserGateDescription")}
          </p>
          <div className="mt-6 grid gap-3">
            {externalOpenUrl ? (
              <Button asChild size="lg" variant="gold" className="w-full">
                <a
                  href={externalOpenUrl}
                  data-browser-target={targetBrowser}
                  data-testid="chat-open-browser"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t(isSafariTarget ? "browserGateOpenSafari" : "browserGateOpenChrome")}
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="w-full"
              onClick={onCopy}
              disabled={!browserUrl}
              data-testid="chat-copy-browser-link"
            >
              {copyStatus === "copied" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copyStatus === "copied"
                ? t("browserGateCopied")
                : t("browserGateCopy")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="w-full"
              onClick={onContinue}
              data-testid="chat-continue-in-app"
            >
              {t("browserGateContinue")}
            </Button>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-600 dark:text-slate-400">
            {t(isSafariTarget ? "browserGateFallbackSafari" : "browserGateFallback")}
          </p>
        </div>
      </div>
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
  lineUrl,
  lineQrImage,
}: {
  mode: ChatExperienceMode;
  propertySlug?: string;
  propertyName?: string;
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
  lineUrl?: string;
  lineQrImage?: string;
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
  const [rankedSuggestions, setRankedSuggestions] = useState<RankedChatSuggestion[]>([]);
  const [contactForm, setContactForm] = useState<ContactForm>({
    email: "",
    preferredApp: "whatsapp",
    contactHandle: "",
  });
  const [contactStatus, setContactStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [keyboardLayoutMode, setKeyboardLayoutMode] = useState<KeyboardLayoutMode>("none");
  const [footerFocusScope, setFooterFocusScope] = useState<FooterFocusScope>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [chatPageViewportHeight, setChatPageViewportHeight] = useState(CHAT_PAGE_VIEWPORT_FALLBACK);
  const [composerReserveHeight, setComposerReserveHeight] = useState(PAGE_COMPOSER_RESERVE_FALLBACK);
  const [browserGateVisible, setBrowserGateVisible] = useState(false);
  const [browserGateUrl, setBrowserGateUrl] = useState<string | null>(null);
  const [browserGateOpenUrl, setBrowserGateOpenUrl] = useState<string | null>(null);
  const [browserGateTargetBrowser, setBrowserGateTargetBrowser] =
    useState<ExternalBrowserTarget["browser"]>("browser");
  const [browserGateCopyStatus, setBrowserGateCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatFooterRef = useRef<HTMLDivElement>(null);
  const contactFormRef = useRef<HTMLFormElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
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
  const staticVisibleSuggestions = useMemo(
    () =>
      selectChatSuggestions({
        candidates: suggestions,
        activePropertySlug: activePropertySlug || undefined,
        latestUserMessage: latestExchange?.userMessage,
        latestAssistantMessage: latestExchange?.assistantMessage,
        clickedSuggestionId: latestExchange?.clickedSuggestionId,
      }) as StaticChatSuggestion[],
    [activePropertySlug, latestExchange, suggestions],
  );
  const rankedVisibleSuggestions = useMemo(
    (): RankedVisibleSuggestion[] =>
      rankedSuggestions.map((suggestion) => ({
        id: suggestion._id,
        text: suggestion.question,
        source: "ranked",
        suggestionSource: suggestion.source,
        suggestionId: suggestion.suggestionId,
        answer: suggestion.answer,
        answerMode: suggestion.answerMode,
        dynamicIntent: suggestion.dynamicIntent,
        topic: suggestion.topic,
        score: suggestion.score,
      })),
    [rankedSuggestions],
  );
  const visibleSuggestions = rankedVisibleSuggestions.length >= 2
    ? rankedVisibleSuggestions
    : staticVisibleSuggestions;
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
          index === latestAssistantIndex ? latestExchange?.clickedSuggestionId : null;
        return getChatActionCard({
          latestUserMessage: previousUserMessageFor(messages, index),
          latestAssistantMessage: message.content,
          activePropertySlug: activePropertySlug || undefined,
          actionHint: message.action,
          clickedSuggestionId,
        });
      }),
    [activePropertySlug, latestAssistantIndex, latestExchange?.clickedSuggestionId, messages],
  );
  const canShowMessageSuggestions =
    !isTyping && latestAssistantIndex >= 0 && latestAssistantIndex === messages.length - 1;
  const latestActionCard = latestAssistantIndex >= 0 ? messageActionCards[latestAssistantIndex] : null;
  const hasLatestActionCard = Boolean(latestActionCard && latestActionCard.type !== "none");
  const chatInputDisabled =
    !messageCacheReady ||
    isTyping ||
    (Boolean(convex) && !sessionReady && messages.length === 0) ||
    (isHydratingSession && messages.length === 0);
  const hideFloatingTriggerOnMobileRoom = normalizedPathname.startsWith("/rooms/");
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
    keyboardLayoutMode === "overlayInset" || keyboardLayoutMode === "overlayFallback";
  const contactFocused = footerFocusScope === "contact";
  const mobileKeyboardActive =
    isMobileViewport && (footerFocusScope !== null || keyboardLayoutMode !== "none");
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

  const isTranscriptNearEnd = useCallback(() => {
    const messagesNode = chatMessagesRef.current;
    if (!messagesNode) return true;

    const remainingScroll =
      messagesNode.scrollHeight - messagesNode.scrollTop - messagesNode.clientHeight;
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
  }, [isTranscriptNearEnd, mode, scrollTranscriptToEnd, updateChatPageViewportHeight]);

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
        detection.platform === "ios" ? "safari" : detection.platform === "android" ? "chrome" : "browser",
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
        cachedTranscript.latestExchange ?? latestExchangeFromMessages(cachedTranscript.messages),
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
    setRankedSuggestions([]);
  }, [activePropertySlug]);

  useEffect(() => {
    let cancelled = false;

    async function loadRankedSuggestions() {
      setRankedSuggestions([]);
      if (!convex || !sessionId || !latestExchange?.assistantMessage) return;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (attempt > 0) await wait(750);
        try {
          const nextSuggestions = await getNextChatSuggestions(convex, {
            sessionId,
            locale,
            limit: 2,
          });
          if (cancelled) return;
          if (nextSuggestions.length >= 2) {
            await markChatSuggestionsShown(convex, {
              sessionId,
              suggestions: nextSuggestions.map((suggestion) => ({
                source: suggestion.source,
                suggestionId: suggestion.suggestionId,
              })),
            }).catch(() => null);
            if (cancelled) return;
            setRankedSuggestions(nextSuggestions);
            return;
          }
        } catch {
          if (cancelled) return;
        }
      }
    }

    void loadRankedSuggestions();
    return () => {
      cancelled = true;
    };
  }, [
    convex,
    latestExchange?.assistantMessage,
    latestExchange?.userMessage,
    locale,
    sessionId,
  ]);

  const createFreshSession = useCallback(async (generation = chatGenerationRef.current) => {
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
  }, [activePropertySlug, convex]);

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
      if (enforceReusableLimit && transcript.length >= REUSABLE_CHAT_MESSAGE_LIMIT) {
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
            await hydrateExistingSession(sessionId, markOpen, hydrateMessages, true, generation);
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
          await hydrateExistingSession(storedId, markOpen, hydrateMessages, true, generation);
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
          handoffToken = await createChatBrowserHandoff(convex, { sessionId: id });
        }
      } catch {
        // The browser link still works without a restorable Convex session.
      }

      if (cancelled) return;

      const browserUrl = appendChatExternalParams(window.location.href, {
        handoffToken,
      });
      const target = buildExternalBrowserTarget(browserUrl, navigator.userAgent);
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
  }, [
    browserGateVisible,
    convex,
    ensureSession,
    messageCacheReady,
    mode,
  ]);

  const primeSessionForOpen = useCallback(async () => {
    const generation = chatGenerationRef.current;
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
    setRankedSuggestions([]);
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
        await closeChatSession(convex, { sessionId: previousSessionId }).catch(() => undefined);
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
    if (!open || !messageCacheReady || sessionReady || isHydratingSession) return;
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
        keyboardViewportBaselineRef.current ??= getKeyboardViewportBaselineHeight();
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
  }, [footerFocusScope, keyboardLayoutMode, mode, open, updateChatPageViewportHeight]);

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
  }, [hasLatestActionCard, messages.length, open, scrollTranscriptToEnd]);

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
        phone: contactForm.preferredApp === "whatsapp" ? contactForm.contactHandle || undefined : undefined,
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
    for (let attempt = 0; attempt < TRANSCRIPT_RECOVERY_ATTEMPTS; attempt += 1) {
      if (generation !== chatGenerationRef.current) return null;
      if (attempt > 0) await wait(TRANSCRIPT_RECOVERY_DELAY_MS);
      if (generation !== chatGenerationRef.current) return null;

      try {
        const transcript = await getChatMessages(convex!, { sessionId, limit: 25 });
        if (generation !== chatGenerationRef.current) return null;
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
    action?: ChatActionHint | null,
    generation = chatGenerationRef.current,
  ) {
    for (let attempt = 0; attempt < BACKGROUND_RECONCILE_ATTEMPTS; attempt += 1) {
      await wait(BACKGROUND_RECONCILE_DELAY_MS);
      if (generation !== chatGenerationRef.current) return;
      const recoveredMessage = await recoverPersistedAssistantMessage(
        sessionId,
        userMessage,
        generation,
      );
      if (!recoveredMessage || recoveredMessage === placeholderMessage) continue;
      if (generation !== chatGenerationRef.current) return;

      setMessages((items) => {
        const next = [...items];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index]?.role === "assistant" && next[index]?.content === placeholderMessage) {
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
    const selectedSuggestion =
      typeof inputOrSuggestion === "string" ? null : inputOrSuggestion;
    const text =
      typeof inputOrSuggestion === "string"
        ? inputOrSuggestion
        : inputOrSuggestion.text;
    const clean = text.trim();
    if (!clean || chatInputDisabled) return;
    setInput("");
    setLatestExchange(null);
    setRankedSuggestions([]);
    setMessages((items) => [...items, { role: "user", content: clean }]);

    const rankedSuggestion =
      selectedSuggestion?.source === "ranked" ? selectedSuggestion : null;
    const preset = rankedSuggestion ? undefined : suggestions.find((item) => item.text === clean);
    const selectedActionHint = resolveChatActionHint({
      latestUserMessage: clean,
      activePropertySlug: activePropertySlug || undefined,
      clickedSuggestionId: preset?.id,
      rankedSuggestionTopic: rankedSuggestion?.dynamicIntent ?? rankedSuggestion?.topic,
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

    if (rankedSuggestion?.answerMode === "static" && rankedSuggestion.answer?.trim()) {
      const assistantMessage = rankedSuggestion.answer.trim();
      setMessages((items) => [
        ...items,
        createAssistantMessage(assistantMessage, selectedActionHint),
      ]);
      setLatestExchange({
        userMessage: clean,
        assistantMessage,
      });
      if (convex) {
        try {
          const id = await ensureSession({ markOpen: true, generation });
          if (generation !== chatGenerationRef.current) return;
          if (id) {
            await markChatSuggestionClicked(convex, {
              sessionId: id,
              suggestion: {
                source: rankedSuggestion.suggestionSource,
                suggestionId: rankedSuggestion.suggestionId,
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
              content: assistantMessage,
              ...(selectedActionHint ? { action: selectedActionHint } : {}),
            });
          }
        } catch {
          // The visitor still sees the saved answer if persistence is temporarily unavailable.
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
      if (rankedSuggestion) {
        await markChatSuggestionClicked(convex, {
          sessionId: id,
          suggestion: {
            source: rankedSuggestion.suggestionSource,
            suggestionId: rankedSuggestion.suggestionId,
          },
        }).catch(() => null);
      }
      if (generation !== chatGenerationRef.current) return;
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
      setMessages((items) => [...items, createAssistantMessage(response, selectedActionHint)]);
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

  if (mode === "page" && hydrated && browserGateVisible) {
    return (
      <ChatBrowserGate
        browserUrl={browserGateUrl}
        copyStatus={browserGateCopyStatus}
        externalOpenUrl={browserGateOpenUrl}
        targetBrowser={browserGateTargetBrowser}
        onContinue={continueInAppBrowser}
        onCopy={copyBrowserLink}
      />
    );
  }

  if (mode === "page" && !open) {
    return (
      <div
        data-testid="chat-closing"
        className="flex h-[100dvh] items-center justify-center bg-background text-foreground"
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-gold"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  const panel = (
    <div
      data-testid="chat-panel"
      data-keyboard-layout={keyboardLayoutMode}
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
              <div
                data-testid="chat-initial-prompts"
                className="mx-auto flex w-full max-w-4xl flex-col items-center px-1 pt-7 text-center sm:pt-10"
              >
                {!isTyping ? (
                  <>
                    <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
                      {t("initialPrompt")}
                    </h2>
                    <SuggestionChips
                      suggestions={visibleSuggestions}
                      onSelect={sendMessage}
                      disabled={chatInputDisabled}
                      variant="initial"
                    />
                  </>
                ) : null}
              </div>
            ) : null}
            {messages.map((message, index) => {
              const actionCard = messageActionCards[index] ?? { type: "none" };
              const hasActionCard = message.role === "assistant" && actionCard.type !== "none";

              return (
                <div
                  key={`${message.role}-${index}`}
                  className={cn(
                    "max-w-[85%]",
                    hasActionCard && "w-full max-w-[96%] md:max-w-[85%]",
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
                  {actionCard.type === "booking" ? (
                    <ChatBookingCard context={actionCard.context} />
                  ) : null}
                  {actionCard.type === "tour" ? (
                    <ChatVillaTourCard propertySlug={actionCard.propertySlug} />
                  ) : null}
                  {message.role === "assistant" &&
                  index === latestAssistantIndex &&
                  canShowMessageSuggestions ? (
                    <SuggestionChips
                      suggestions={visibleSuggestions}
                      onSelect={sendMessage}
                      disabled={chatInputDisabled}
                    />
                  ) : null}
                </div>
              );
            })}
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
                lineUrl={lineUrl}
                lineQrImage={lineQrImage}
                quiet={hasLatestActionCard}
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
                    className="h-9 rounded-lg text-base md:text-sm"
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
                      className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-base shadow-none focus-visible:ring-0 md:text-sm"
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
  lineUrl?: string;
  lineQrImage?: string;
}) {
  return <ChatExperience {...props} mode="overlay" />;
}

export function AIChatPage(props: {
  propertySlug?: string;
  propertyName?: string;
  contactEmail: string;
  whatsappNumber: string;
  lineId?: string;
  lineUrl?: string;
  lineQrImage?: string;
}) {
  return <ChatExperience {...props} mode="page" />;
}
