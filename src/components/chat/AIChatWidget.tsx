"use client";

import { CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatShell } from "@/components/chat/ChatShell";
import { MessagingButtons } from "@/components/chat/MessagingButtons";
import {
  useChatSession,
  type ChatExperienceProps,
} from "@/components/chat/useChatSession";
import type { ExternalBrowserTarget } from "@/lib/chat/external-browser";

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
            {t(
              isSafariTarget
                ? "browserGateDescriptionSafari"
                : "browserGateDescription",
            )}
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
                  {t(
                    isSafariTarget
                      ? "browserGateOpenSafari"
                      : "browserGateOpenChrome",
                  )}
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
            {t(
              isSafariTarget
                ? "browserGateFallbackSafari"
                : "browserGateFallback",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatExperience(props: ChatExperienceProps) {
  const t = useTranslations("Chat");
  const {
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
    onComposerPointerDown,
  } = useChatSession(props);

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

  return (
    <ChatShell
      mode={mode}
      open={open}
      hydrated={hydrated}
      mounted={mounted}
      title={title}
      chatHref={chatHref}
      hideFloatingTriggerOnMobileRoom={hideFloatingTriggerOnMobileRoom}
      keyboardLayoutMode={keyboardLayoutMode}
      chatPanelStyle={chatPanelStyle}
      onOpen={openChat}
      onClose={closeChat}
      onRestart={restartChat}
    >
      <ChatMessages
        ref={chatMessagesRef}
        messages={messages}
        messageActionCards={messageActionCards}
        latestAssistantIndex={latestAssistantIndex}
        canShowMessageSuggestions={canShowMessageSuggestions}
        visibleSuggestions={visibleSuggestions}
        onSuggestionSelect={sendMessage}
        chatInputDisabled={chatInputDisabled}
        isTyping={isTyping}
        initialPrompt={t("initialPrompt")}
        thinkingLabel={t("thinking")}
        mode={mode}
        style={messagesStyle}
      />

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

      <ChatComposer
        mode={mode}
        hydrated={hydrated}
        overlayComposerDocked={overlayComposerDocked}
        pageComposerDocked={pageComposerDocked}
        chatFooterStyle={chatFooterStyle}
        hideContactDetails={hideContactDetails}
        hideMainComposer={hideMainComposer}
        chatFooterRef={chatFooterRef}
        contactFormRef={contactFormRef}
        inputRef={inputRef}
        contactForm={contactForm}
        setContactForm={setContactForm}
        contactStatus={contactStatus}
        saveContact={saveContact}
        input={input}
        setInput={setInput}
        sendMessage={sendMessage}
        chatInputDisabled={chatInputDisabled}
        focusFooterInput={focusFooterInput}
        clearFooterFocusAfterBlur={clearFooterFocusAfterBlur}
        onComposerPointerDown={onComposerPointerDown}
      />
    </ChatShell>
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
