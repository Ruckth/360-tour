"use client";

import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useOptionalConvex } from "@/lib/react/convex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatPageContext } from "@/components/chat/ChatContext";
import { MessagingButtons } from "@/components/chat/MessagingButtons";
import {
  addChatMessage,
  askConcierge,
  closeChatSession,
  createChatSession,
  identifyChatVisitor,
  touchChatSession,
} from "@/lib/react/convex-api";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string };
type ContactForm = { name: string; email: string; phone: string };

const VISITOR_ID_STORAGE_KEY = "sv_chat_visitor_id";
const SESSION_ID_STORAGE_KEY = "sv_chat_session_id";
const HEARTBEAT_MS = 30_000;

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

  return {
    currentPath: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer || undefined,
    userAgent: navigator.userAgent || undefined,
  };
}

export function AIChatWidget({
  propertySlug,
  propertyName,
  whatsappNumber,
  lineId,
}: {
  propertySlug?: string;
  propertyName?: string;
  whatsappNumber: string;
  lineId?: string;
}) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const convex = useOptionalConvex();
  const pageContext = useChatPageContext();
  const activePropertySlug = propertySlug ?? pageContext?.context.propertySlug;
  const activePropertyName = propertyName ?? pageContext?.context.propertyName;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [contactForm, setContactForm] = useState<ContactForm>({
    name: "",
    email: "",
    phone: "",
  });
  const [contactStatus, setContactStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  const title = activePropertyName
    ? t("propertyTitle", { propertyName: activePropertyName })
    : t("defaultTitle");
  const suggestions = useMemo(
    () => [
      {
        text: t("suggestionCouple"),
        answer: t("answerCouple"),
      },
      {
        text: t("suggestionDirect"),
        answer: t("answerDirect"),
      },
      {
        text: t("suggestion360"),
        answer: t("answer360"),
      },
    ],
    [t],
  );
  const visibleSuggestions = useMemo(() => suggestions.slice(0, 2), [suggestions]);
  const hideFloatingTriggerOnMobileRoom = pathname.startsWith("/rooms/");
  const shouldLockScroll = open && typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches;
  useBodyScrollLock(shouldLockScroll);

  function openChat() {
    setMounted(true);
    void ensureSession(true);
    window.requestAnimationFrame(() => setOpen(true));
  }

  function closeChat() {
    setOpen(false);
    if (convex && sessionId) {
      void closeChatSession(convex, { sessionId }).catch(() => undefined);
    }
  }

  useEffect(() => {
    function openFromStickyBar() {
      openChat();
    }

    window.addEventListener("open-concierge-chat", openFromStickyBar);
    return () => window.removeEventListener("open-concierge-chat", openFromStickyBar);
  }, []);

  useEffect(() => {
    if (open) return;
    const timeout = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 260);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && window.matchMedia("(min-width: 768px)").matches) {
        closeChat();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function ensureSession(markOpen = false) {
    if (!convex) return null;
    if (sessionId) {
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

    const storedId =
      typeof window !== "undefined" ? window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY) : null;
    if (storedId) {
      try {
        await touchChatSession(convex, {
          sessionId: storedId,
          propertySlug: activePropertySlug || undefined,
          ...getBrowserChatMetadata(),
          isOpen: markOpen,
        });
        setSessionId(storedId);
        return storedId;
      } catch {
        window.sessionStorage.removeItem(SESSION_ID_STORAGE_KEY);
      }
    }

    const id = await createChatSession(convex, {
      propertySlug: activePropertySlug || undefined,
      channel: "web",
      visitorId: getOrCreateVisitorId(),
      ...getBrowserChatMetadata(),
    });
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, id);
    }
    setSessionId(id);
    return id;
  }

  useEffect(() => {
    if (!open) return;
    void ensureSession(true);
  }, [activePropertySlug, convex, open, sessionId]);

  useEffect(() => {
    if (!open || !convex) return;
    const interval = window.setInterval(() => {
      void ensureSession(true);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [activePropertySlug, convex, open, sessionId]);

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactForm.name.trim() && !contactForm.email.trim() && !contactForm.phone.trim()) return;
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
        name: contactForm.name || undefined,
        email: contactForm.email || undefined,
        phone: contactForm.phone || undefined,
      });
      setContactStatus("saved");
    } catch {
      setContactStatus("error");
    }
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || isTyping) return;
    setInput("");
    setMessages((items) => [...items, { role: "user", content: clean }]);

    const preset = suggestions.find((item) => item.text === clean);
    if (preset) {
      setMessages((items) => [...items, { role: "assistant", content: preset.answer }]);
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
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
            content:
            t("noConvex"),
        },
      ]);
      return;
    }

    setIsTyping(true);
    try {
      const id = await ensureSession(true);
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
    } catch {
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
            content:
            t("fallback"),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openChat}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105",
          hideFloatingTriggerOnMobileRoom && "hidden md:flex",
          open && "pointer-events-none opacity-0",
        )}
        aria-label={t("open")}
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {mounted ? (
        <div
          className={cn(
            "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none md:pointer-events-none md:bg-transparent md:backdrop-blur-0",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          <div
            className={cn(
              "pointer-events-auto fixed inset-0 flex h-[100dvh] flex-col overflow-hidden border-border bg-card shadow-2xl transition duration-300 ease-out motion-reduce:transition-none md:inset-auto md:bottom-5 md:right-5 md:h-[70vh] md:max-h-[720px] md:w-[480px] md:origin-bottom-right md:rounded-2xl md:border",
              open
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-8 scale-[0.98] opacity-0 md:translate-y-3 md:scale-95",
            )}
          >
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-4 py-2.5 text-white md:px-4 md:py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-gold" />
              <p className="text-sm font-semibold">{title}</p>
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

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 md:px-4 md:py-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl bg-muted p-4 text-base leading-relaxed text-slate-700 dark:text-slate-200 md:p-3 md:text-sm">
                {t("intro")}
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {renderMessage(message.content)}
              </div>
            ))}
            {isTyping ? (
              <div className="inline-flex rounded-2xl bg-muted px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                {t("thinking")}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 space-y-3 border-t border-border bg-card/95 px-4 py-4 backdrop-blur md:px-3 md:py-3">
            <div className="flex flex-wrap gap-2">
              {visibleSuggestions.map((item) => (
                <button
                  key={item.text}
                  type="button"
                  onClick={() => sendMessage(item.text)}
                  className="rounded-full border border-border bg-background/80 px-3 py-1.5 text-left text-[11px] font-medium leading-tight text-slate-700 shadow-sm transition hover:border-gold/50 hover:bg-gold/10 hover:text-foreground dark:text-slate-300 dark:hover:text-white"
                >
                  {item.text}
                </button>
              ))}
            </div>
            <MessagingButtons whatsappNumber={whatsappNumber} lineId={lineId} />
            <details className="rounded-xl border border-border bg-background/70 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-300">
                {t("shareContact")}
              </summary>
              <form className="mt-3 grid gap-2" onSubmit={saveContact}>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    value={contactForm.name}
                    onChange={(event) =>
                      setContactForm((current) => ({ ...current, name: event.target.value }))
                    }
                    className="h-9 rounded-lg text-sm"
                    placeholder={t("name")}
                    aria-label={t("name")}
                  />
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
                  <Input
                    value={contactForm.phone}
                    onChange={(event) =>
                      setContactForm((current) => ({ ...current, phone: event.target.value }))
                    }
                    className="h-9 rounded-lg text-sm"
                    placeholder={t("phone")}
                    aria-label={t("phone")}
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
                className="h-12 min-w-0 flex-1 rounded-xl text-base placeholder:text-slate-500 dark:placeholder:text-slate-400 md:h-10 md:rounded-lg md:text-sm"
                placeholder={t("askPlaceholder")}
              />
              <Button type="submit" size="icon" aria-label={t("send")}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
