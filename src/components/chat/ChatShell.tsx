"use client";

import Link from "@/platform/link";
import { MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { useTranslations } from "@/platform/intl";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
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
  hideFloatingTriggerOnMobile,
  keyboardLayoutMode,
  chatPanelStyle,
  inputRef,
  onOpen,
  onClose,
  onRestart,
  hasConversation = false,
  children,
}: {
  mode: "overlay" | "page";
  open: boolean;
  hydrated: boolean;
  mounted: boolean;
  title: string;
  chatHref: string;
  hideFloatingTriggerOnMobile: boolean;
  keyboardLayoutMode: string;
  chatPanelStyle?: CSSProperties;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onOpen: () => void;
  onClose: () => void;
  onRestart: () => void;
  /** When true, Restart asks for confirmation before discarding the conversation. */
  hasConversation?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Chat");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  // Where focus goes after the confirmation closes: "keep" opens it, "restart" returns to the header.
  const focusAfterConfirm = useRef<"keep" | "restart" | null>(null);
  useEffect(() => {
    const target = focusAfterConfirm.current;
    focusAfterConfirm.current = null;
    if (target === "keep") keepRef.current?.focus({ preventScroll: true });
    else if (target === "restart") restartRef.current?.focus({ preventScroll: true });
  }, [confirmingRestart]);
  const requestRestart = () => {
    if (!hasConversation) return onRestart();
    focusAfterConfirm.current = "keep";
    setConfirmingRestart(true);
  };
  const cancelRestart = () => {
    focusAfterConfirm.current = "restart";
    setConfirmingRestart(false);
  };
  const confirmRestart = () => {
    focusAfterConfirm.current = "restart";
    setConfirmingRestart(false);
    onRestart();
  };

  useEffect(() => {
    if (mode !== "overlay" || !open || !hydrated || !mounted) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;

    const input = inputRef.current;
    if (input && !input.disabled) input.focus({ preventScroll: true });
    // Session startup can leave the composer disabled throughout the opening animation.
    if (!panel.contains(document.activeElement)) closeRef.current?.focus({ preventScroll: true });
  }, [mode, open, hydrated, mounted, inputRef]);

  useEffect(() => {
    if (mode !== "overlay") return;
    window.addEventListener("open-concierge-chat", onOpen);
    return () => window.removeEventListener("open-concierge-chat", onOpen);
  }, [mode, onOpen]);

  const panel = (
    <div
      ref={panelRef}
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
            ref={restartRef}
            onClick={requestRestart}
            aria-expanded={hasConversation ? confirmingRestart : undefined}
            aria-controls={confirmingRestart ? confirmId : undefined}
            className="h-8 rounded-full px-2 text-sm font-semibold text-white hover:bg-white/10 hover:text-white pointer-coarse:h-11"
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
          ref={closeRef}
          onClick={onClose}
          className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {confirmingRestart ? (
        <div
          id={confirmId}
          role="alertdialog"
          aria-labelledby={`${confirmId}-title`}
          aria-describedby={`${confirmId}-body`}
          data-testid="chat-restart-confirm"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Escape cancels the question only; it must not also close the desktop overlay.
            event.stopPropagation();
            cancelRestart();
          }}
          className="shrink-0 border-b border-border bg-muted/60 px-4 py-3 text-sm"
        >
          <p id={`${confirmId}-title`} className="font-semibold text-foreground">{t("restartConfirmTitle")}</p>
          <p id={`${confirmId}-body`} className="mt-0.5 text-muted-foreground">{t("restartConfirmBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button ref={keepRef} type="button" size="sm" variant="outline" className="pointer-coarse:min-h-11" onClick={cancelRestart}>
              {t("restartKeep")}
            </Button>
            <Button type="button" size="sm" variant="destructive" className="pointer-coarse:min-h-11" onClick={confirmRestart}>
              {t("restartConfirm")}
            </Button>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );

  if (mode === "page") return panel;

  return (
    <>
      {!hideFloatingTriggerOnMobile ? (
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
