"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { ContactAppBrandIcon } from "@/components/chat/ContactAppBrandIcon";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ContactApp = "whatsapp" | "line";
export type ContactForm = {
  email: string;
  preferredApp: ContactApp;
  contactHandle: string;
};
const contactApps: ContactApp[] = ["whatsapp", "line"];

function ContactAppIcon({ app }: { app: ContactApp }) {
  return (
    <ContactAppBrandIcon
      app={app}
      className="h-5 w-5"
      data-testid={`contact-app-icon-${app}`}
    />
  );
}

export function ChatComposer({
  mode,
  hydrated,
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
  sendMessage,
  chatInputDisabled,
  focusFooterInput,
  clearFooterFocusAfterBlur,
  onComposerPointerDown,
}: {
  mode: "overlay" | "page";
  hydrated: boolean;
  overlayComposerDocked: boolean;
  pageComposerDocked: boolean;
  chatFooterStyle?: CSSProperties;
  hideContactDetails: boolean;
  hideMainComposer: boolean;
  chatFooterRef: RefObject<HTMLDivElement | null>;
  contactFormRef: RefObject<HTMLFormElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  contactForm: ContactForm;
  setContactForm: Dispatch<SetStateAction<ContactForm>>;
  contactStatus: "idle" | "saving" | "saved" | "error";
  saveContact: (event: FormEvent<HTMLFormElement>) => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  sendMessage: (message: string) => void;
  chatInputDisabled: boolean;
  focusFooterInput: (scope: "composer" | "contact") => void;
  clearFooterFocusAfterBlur: () => void;
  onComposerPointerDown: () => void;
}) {
  const t = useTranslations("Chat");
  return (
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
      {hydrated ? (
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
                  setContactForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
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
                    setContactForm((current) => ({
                      ...current,
                      contactHandle: event.target.value,
                    }))
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
      ) : null}
      <form
        className={cn(
          "flex items-end gap-2",
          hideMainComposer && "hidden md:flex",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage(input);
        }}
      >
        <ChatInput
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              sendMessage(input);
            }
          }}
          onPointerDown={() => {
            onComposerPointerDown();
          }}
          onFocus={() => {
            focusFooterInput("composer");
          }}
          onBlur={clearFooterFocusAfterBlur}
          placeholder={t("askPlaceholder")}
          enterKeyHint="send"
          aria-label={t("askPlaceholder")}
          disabled={chatInputDisabled}
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
  );
}
