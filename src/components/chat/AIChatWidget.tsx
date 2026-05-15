"use client";

import { ArrowRight, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "convex/_generated/api";
import { useOptionalConvex } from "@/lib/react/convex";
import { Button } from "@/components/ui/Button";
import { MessagingButtons } from "@/components/chat/MessagingButtons";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string };

const suggestions = [
  {
    text: "Which villa is best for a couple?",
    answer:
      "The Garden Suite is the quietest couples' retreat. If you want more space and your own pool, the Pool Villa is the indulgent step-up.",
  },
  {
    text: "What's included when booking direct?",
    answer:
      "Direct booking saves around 15% versus OTA pricing and keeps support with the host. Airport pickup, welcome amenities, and direct WhatsApp help are the big wins.",
  },
  {
    text: "Can I see the villa in 360?",
    answer:
      "Yes. Open any villa card or detail page and choose Explore 360. You can move room to room with hotspots and finish directly into booking.",
  },
];

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
  const convex = useOptionalConvex();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const pathname = usePathname();

  const title = propertyName ? `${propertyName} concierge` : "Seaview concierge";
  const visibleSuggestions = useMemo(() => suggestions.slice(0, 2), []);
  const hideFloatingTriggerOnMobileRoom = pathname.startsWith("/rooms/");

  useEffect(() => {
    function openFromStickyBar() {
      setOpen(true);
    }

    window.addEventListener("open-concierge-chat", openFromStickyBar);
    return () => window.removeEventListener("open-concierge-chat", openFromStickyBar);
  }, []);

  async function ensureSession() {
    if (sessionId) return sessionId;
    if (!convex) return null;
    const id = await convex.mutation(api.chat.createSession, {
      propertySlug: propertySlug || undefined,
      channel: "web",
    } as never);
    setSessionId(id as string);
    return id as string;
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || isTyping) return;
    setInput("");
    setMessages((items) => [...items, { role: "user", content: clean }]);

    const preset = suggestions.find((item) => item.text === clean);
    if (preset) {
      setMessages((items) => [...items, { role: "assistant", content: preset.answer }]);
      return;
    }

    if (!convex) {
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          content:
            "I can help compare villas here, and live chat will connect once Convex is configured for this Next.js app.",
        },
      ]);
      return;
    }

    setIsTyping(true);
    try {
      const id = await ensureSession();
      if (!id) throw new Error("No chat session");
      const result = await convex.action(api.chatAi.respond, {
        sessionId: id,
        userMessage: clean,
        propertySlug: propertySlug || undefined,
      } as never);
      const response =
        typeof result === "object" && result && "response" in result
          ? String(result.response)
          : "I sent that to the concierge. Please use WhatsApp if you need an immediate reply.";
      setMessages((items) => [...items, { role: "assistant", content: response }]);
    } catch {
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          content:
            "I’m having trouble connecting to the live concierge. WhatsApp is the fastest fallback for now.",
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
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105",
          hideFloatingTriggerOnMobileRoom && "hidden md:flex",
          open && "pointer-events-none opacity-0",
        )}
        aria-label="Open concierge chat"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed bottom-5 right-5 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl md:w-96">
          <div className="flex items-center justify-between border-b border-border bg-navy px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold" />
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-white/55">Ask, compare, or book direct</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-xl bg-muted p-3 text-sm leading-relaxed text-muted-foreground">
                I can help pick the right villa, explain direct booking savings, or point you into the 360 tour.
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
                {message.content}
              </div>
            ))}
            {isTyping ? (
              <div className="inline-flex rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                Thinking...
              </div>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-border p-3">
            <div className="grid gap-2">
              {visibleSuggestions.map((item) => (
                <button
                  key={item.text}
                  type="button"
                  onClick={() => sendMessage(item.text)}
                  className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-secondary"
                >
                  {item.text}
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
            <MessagingButtons whatsappNumber={whatsappNumber} lineId={lineId} />
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                placeholder="Ask a question"
              />
              <Button type="submit" size="icon" aria-label="Send message">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
