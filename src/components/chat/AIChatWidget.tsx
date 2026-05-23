"use client";

import Link from "next/link";
import { MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { useOptionalConvex } from "@/lib/react/convex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ChatBookingCard } from "@/components/chat/ChatBookingCard";
import { useChatPageContext } from "@/components/chat/ChatContext";
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
type LatestExchange = {
  userMessage: string;
  assistantMessage: string;
  clickedSuggestionId?: ChatSuggestionId | null;
};

const VISITOR_ID_STORAGE_KEY = "sv_chat_visitor_id";
const SESSION_ID_STORAGE_KEY = "sv_chat_session_id";
const REUSABLE_CHAT_MESSAGE_LIMIT = 20;
const HEARTBEAT_MS = 30_000;
const contactApps: ContactApp[] = ["whatsapp", "line"];
const TRANSCRIPT_RECOVERY_ATTEMPTS = 10;
const TRANSCRIPT_RECOVERY_DELAY_MS = 2_000;
const BACKGROUND_RECONCILE_ATTEMPTS = 30;
const BACKGROUND_RECONCILE_DELAY_MS = 2_000;
const MOBILE_KEYBOARD_THRESHOLD = 80;
const CHAT_PAGE_HEADER_OFFSET = 64;
const CHAT_PAGE_MIN_HEIGHT = 360;
const CHAT_PAGE_VIEWPORT_FALLBACK = "calc(100svh - 4rem)";

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

function SuggestionChips({
  suggestions,
  onSelect,
}: {
  suggestions: ChatSuggestion[];
  onSelect: (text: string) => void;
}) {
  if (!suggestions.length) return null;

  return (
    <div data-testid="chat-suggestions" className="mt-2 flex flex-wrap gap-2">
      {suggestions.map((item) => (
        <button
          key={item.id}
          type="button"
          data-suggestion-id={item.id}
          onClick={() => onSelect(item.text)}
          className="rounded-full border border-border bg-background/85 px-3 py-1.5 text-left text-[11px] font-medium leading-tight text-slate-700 shadow-sm shadow-black/5 transition hover:border-gold/60 hover:bg-gold/10 hover:text-foreground dark:border-white/15 dark:bg-background/60 dark:text-slate-300 dark:hover:text-white"
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}

function ContactAppIcon({ app }: { app: ContactApp }) {
  if (app === "whatsapp") {
    return (
      <span
        data-testid="contact-app-icon-whatsapp"
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0a9f6a] text-white"
      >
        <MessageCircle className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      data-testid="contact-app-icon-line"
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#06c755] text-white"
    >
      <MessageCircle className="h-3.5 w-3.5" />
    </span>
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
  mode,
  propertySlug,
  propertyName,
  whatsappNumber,
  lineId,
}: {
  mode: ChatExperienceMode;
  propertySlug?: string;
  propertyName?: string;
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
  const [composerFocused, setComposerFocused] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [chatPageViewportHeight, setChatPageViewportHeight] = useState(CHAT_PAGE_VIEWPORT_FALLBACK);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const keyboardInsetRef = useRef(0);
  const pathname = usePathname();
  const normalizedPathname = stripLocalePrefix(pathname);

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
  const hideFloatingTriggerOnMobileRoom = normalizedPathname.startsWith("/rooms/");
  const liftFloatingTriggerOnBooking = pathname === "/booking" || pathname.includes("/booking");
  const chatHref = localizeHref(
    activePropertySlug ? `/chat?property=${encodeURIComponent(activePropertySlug)}` : "/chat",
    locale,
  );
  const shouldLockScroll =
    mode === "overlay" &&
    open &&
    typeof window !== "undefined" &&
    !window.matchMedia("(min-width: 768px)").matches;
  const keyboardInsetActive = mobileKeyboardInset > MOBILE_KEYBOARD_THRESHOLD;
  const mobileKeyboardActive =
    isMobileViewport && (composerFocused || keyboardInsetActive);
  const hideAuxiliaryControls = mobileKeyboardActive;
  const overlayComposerDocked =
    mode === "overlay" && mobileKeyboardActive && keyboardInsetActive;
  const chatFooterStyle =
    overlayComposerDocked
      ? {
          bottom: mobileKeyboardInset,
          left: 0,
          position: "fixed" as const,
          right: 0,
          zIndex: 60,
        }
      : undefined;
  const messagesStyle =
    overlayComposerDocked
      ? { paddingBottom: "1rem" }
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
    [80, 180, 360].forEach((delay) => {
      window.setTimeout(() => {
        updateChatPageViewportHeight();
        scrollTranscriptToEnd();
      }, delay);
    });
  }, [mode, scrollTranscriptToEnd, updateChatPageViewportHeight]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
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
    async (id: string, markOpen = false) => {
      if (!convex) return null;
      await touchChatSession(convex, {
        sessionId: id,
        propertySlug: activePropertySlug || undefined,
        ...getBrowserChatMetadata(),
        isOpen: markOpen,
      });

      const transcript = await getChatMessages(convex, {
        sessionId: id,
        limit: REUSABLE_CHAT_MESSAGE_LIMIT,
      });
      if (transcript.length >= REUSABLE_CHAT_MESSAGE_LIMIT) {
        throw new Error("Chat session has reached the reusable message limit.");
      }

      const restoredMessages = normalizeTranscriptMessages(transcript);
      setStoredSessionId(id);
      setSessionId(id);
      setMessages(restoredMessages);
      setLatestExchange(latestExchangeFromMessages(restoredMessages));
      return id;
    },
    [activePropertySlug, convex],
  );

  const ensureSession = useCallback(
    async (markOpen = false, validateForReuse = false) => {
      if (!convex) return null;
      if (sessionId) {
        if (validateForReuse) {
          try {
            await hydrateExistingSession(sessionId, markOpen);
            return sessionId;
          } catch {
            clearStoredSessionId();
            setSessionId(null);
            setMessages([]);
            setLatestExchange(null);
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
          await hydrateExistingSession(storedId, markOpen);
          return storedId;
        } catch {
          clearStoredSessionId();
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
            return await hydrateExistingSession(reusableSession._id, markOpen);
          }
        } catch {
          // If lookup fails, create a clean session so chat stays available.
        }
      }

      return await createFreshSession();
    },
    [activePropertySlug, convex, createFreshSession, hydrateExistingSession, sessionId],
  );

  const openChat = useCallback(() => {
    if (mode === "page") return;
    setMounted(true);
    void ensureSession(true, true);
    setOpen(true);
  }, [ensureSession, mode]);

  const restartChat = useCallback(async () => {
    if (!convex) {
      clearStoredSessionId();
      setSessionId(null);
      setMessages([]);
      setLatestExchange(null);
      setInput("");
      setIsTyping(false);
      setContactStatus("idle");
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
      setOpen(true);
    } catch {
      setContactStatus("error");
    }
  }, [convex, createFreshSession]);

  const closeChat = useCallback(() => {
    if (mode === "page") {
      if (convex && sessionId) {
        void closeChatSession(convex, { sessionId }).catch(() => undefined);
      }
      router.push(localizeHref("/", locale));
      return;
    }

    setOpen(false);
    if (convex && sessionId) {
      void closeChatSession(convex, { sessionId }).catch(() => undefined);
    }
  }, [convex, locale, mode, router, sessionId]);

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
      setMobileKeyboardInset(0);
      setComposerFocused(false);
      return;
    }

    const mobileQuery = window.matchMedia("(max-width: 767px)");
    let frame = 0;

    function updateKeyboardInset() {
      setIsMobileViewport(mobileQuery.matches);
      updateChatPageViewportHeight();
      if (!mobileQuery.matches) {
        keyboardInsetRef.current = 0;
        setMobileKeyboardInset(0);
        return;
      }

      const visualViewport = window.visualViewport;
      const nextInset = Math.max(
        0,
        Math.round(
          window.innerHeight -
            ((visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0)),
        ),
      );
      const previousInset = keyboardInsetRef.current;
      if (Math.abs(nextInset - previousInset) < 8 && nextInset !== 0) return;

      keyboardInsetRef.current = nextInset;
      setMobileKeyboardInset(nextInset);
      if (nextInset <= MOBILE_KEYBOARD_THRESHOLD && document.activeElement !== inputRef.current) {
        setComposerFocused(false);
      }
    }

    function scheduleKeyboardInsetUpdate() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateKeyboardInset);
    }

    scheduleKeyboardInsetUpdate();
    window.visualViewport?.addEventListener("resize", scheduleKeyboardInsetUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleKeyboardInsetUpdate);
    window.addEventListener("resize", scheduleKeyboardInsetUpdate);
    window.addEventListener("orientationchange", scheduleKeyboardInsetUpdate);
    mobileQuery.addEventListener("change", scheduleKeyboardInsetUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleKeyboardInsetUpdate);
      window.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      window.removeEventListener("orientationchange", scheduleKeyboardInsetUpdate);
      mobileQuery.removeEventListener("change", scheduleKeyboardInsetUpdate);
    };
  }, [mode, open, updateChatPageViewportHeight]);

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
      void ensureSession(true);
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
      const id = await ensureSession(true);
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
    if (!clean || isTyping) return;
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
          const id = await ensureSession(true);
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
      id = await ensureSession(true);
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
          : "mx-auto mt-16 flex w-full max-w-3xl flex-col overflow-hidden bg-card",
        mode === "overlay" &&
          (open
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-8 scale-[0.98] opacity-0 md:translate-y-3 md:scale-95"),
      )}
      style={mode === "page" ? { height: chatPageViewportHeight } : undefined}
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
                  <SuggestionChips suggestions={visibleSuggestions} onSelect={sendMessage} />
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
                  <SuggestionChips suggestions={visibleSuggestions} onSelect={sendMessage} />
                ) : null}
              </div>
            ))}
            {isTyping ? (
              <TypingIndicator label={t("thinking")} />
            ) : null}
            <div ref={transcriptEndRef} />
          </div>

          <div
            data-testid="chat-footer"
            className={cn(
              "shrink-0 space-y-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:px-3 md:py-3",
              mode === "page" && "pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]",
              mode === "overlay" &&
                overlayComposerDocked &&
                "shadow-[0_-18px_40px_rgba(0,0,0,0.22)] md:shadow-none",
            )}
            style={chatFooterStyle}
          >
            <div className={cn(hideAuxiliaryControls && "hidden md:block")}>
              <MessagingButtons
                whatsappNumber={whatsappNumber}
                lineId={lineId}
                quiet={canShowBookingCard}
              />
            </div>
            <details
              className={cn(
                "rounded-xl border border-border bg-background/70 px-3 py-2 text-sm",
                hideAuxiliaryControls && "hidden md:block",
              )}
            >
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-300">
                {t("shareContact")}
              </summary>
              <form className="mt-3 grid gap-2" onSubmit={saveContact}>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)]">
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
                    <SelectTrigger
                      aria-label={t("preferredApp")}
                      className="h-9 rounded-lg px-3 text-sm"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ContactAppIcon app={contactForm.preferredApp} />
                        <span className="truncate">{t(contactForm.preferredApp)}</span>
                      </span>
                    </SelectTrigger>
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
                  <Input
                    value={contactForm.contactHandle}
                    onChange={(event) =>
                      setContactForm((current) => ({ ...current, contactHandle: event.target.value }))
                    }
                    className="h-9 rounded-lg text-sm"
                    placeholder={
                      contactForm.preferredApp === "whatsapp"
                        ? t("whatsappPlaceholder")
                        : t("linePlaceholder")
                    }
                    aria-label={t("contactHandle")}
                  />
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
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onFocus={() => {
                  setComposerFocused(true);
                  refreshChatPageAfterKeyboardChange();
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setComposerFocused(false);
                    refreshChatPageAfterKeyboardChange();
                  }, 120);
                }}
                className="h-12 min-w-0 flex-1 rounded-2xl border-muted bg-muted/70 px-4 text-base placeholder:text-slate-500 focus-visible:ring-2 dark:placeholder:text-slate-400 md:h-10 md:rounded-lg md:bg-background md:px-3 md:text-sm"
                placeholder={t("askPlaceholder")}
                enterKeyHint="send"
              />
              <Button
                type="submit"
                size="icon"
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
              className={cn(
                "fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105 md:hidden",
                liftFloatingTriggerOnBooking && "bottom-24",
              )}
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
              liftFloatingTriggerOnBooking && "md:bottom-5",
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
  whatsappNumber: string;
  lineId?: string;
}) {
  return <ChatExperience {...props} mode="overlay" />;
}

export function AIChatPage(props: {
  propertySlug?: string;
  propertyName?: string;
  whatsappNumber: string;
  lineId?: string;
}) {
  return <ChatExperience {...props} mode="page" />;
}
