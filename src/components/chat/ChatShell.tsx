"use client";

import Link from "next/link";
import { MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ExpandableChat } from "@/components/ui/chat/expandable-chat";
import { cn } from "@/lib/utils";

export function ChatShell({
  mode,
  open,
  hydrated,
  mounted,
  title,
  chatHref,
  hideFloatingTriggerOnMobileRoom,
  keyboardLayoutMode,
  chatPanelStyle,
  onOpen,
  onClose,
  onRestart,
  children,
}: {
  mode: "overlay" | "page";
  open: boolean;
  hydrated: boolean;
  mounted: boolean;
  title: string;
  chatHref: string;
  hideFloatingTriggerOnMobileRoom: boolean;
  keyboardLayoutMode: string;
  chatPanelStyle?: CSSProperties;
  onOpen: () => void;
  onClose: () => void;
  onRestart: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("Chat");

  useEffect(() => {
    if (mode !== "overlay") return;
    window.addEventListener("open-concierge-chat", onOpen);
    return () => window.removeEventListener("open-concierge-chat", onOpen);
  }, [mode, onOpen]);

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
            onClick={onRestart}
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
          onClick={onClose}
          className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );

  if (mode === "page") return panel;

  return (
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
        onClick={onOpen}
        className={cn(
          "fixed bottom-5 right-5 z-50 hidden h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-2xl shadow-black/20 transition hover:scale-105 md:flex",
          open && "pointer-events-none opacity-0",
        )}
        aria-label={t("open")}
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      {hydrated ? (
        <ExpandableChat open={open} mounted={mounted}>
          {panel}
        </ExpandableChat>
      ) : null}
    </>
  );
}
