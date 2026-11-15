"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import {
  CHAT_PAGE_HEADER_OFFSET,
  CHAT_PAGE_MIN_HEIGHT,
  CHAT_PAGE_VIEWPORT_FALLBACK,
  getFocusedFooterInput,
  getKeyboardLayoutMeasurement,
  getKeyboardViewportBaselineHeight,
  isKeyboardOverlayBrowser,
  KEYBOARD_INSET_EPSILON,
  KEYBOARD_PROBE_DELAYS_MS,
  MOBILE_KEYBOARD_THRESHOLD,
  PAGE_COMPOSER_RESERVE_FALLBACK,
  type ChatExperienceMode,
  type KeyboardLayoutMode,
} from "@/components/chat/session/keyboard-viewport";

type FooterFocusScope = "composer" | "contact" | null;
type ChatPanelStyle = CSSProperties & { "--chat-keyboard-inset"?: string; "--chat-visible-height"?: string };
export function useChatViewport(mode: ChatExperienceMode, open: boolean, mounted: boolean) {
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatFooterRef = useRef<HTMLDivElement>(null);
  const contactFormRef = useRef<HTMLFormElement>(null);
  const keyboardInsetRef = useRef(0);
  const keyboardFocusStartedAtRef = useRef(0);
  const keyboardViewportBaselineRef = useRef<number | null>(null);
  const timers = useRef(new Map<number, () => void>());
  const wait = useCallback((ms: number) => new Promise<void>(resolve => {
    const id = window.setTimeout(() => { timers.current.delete(id); resolve(); }, ms);
    timers.current.set(id, resolve);
  }), []);
  useEffect(() => { const pending = timers.current; return () => { for (const [id, resolve] of pending) { clearTimeout(id); resolve(); } pending.clear(); }; }, []);
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
      void wait(delay).then(() => {
        if (!chatFooterRef.current) return;
        updateChatPageViewportHeight();
        inputRef.current?.scrollIntoView({ block: "nearest" });
        if (shouldKeepTranscriptPinned) scrollTranscriptToEnd();
      });
    });
  }, [
    wait,
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
    void wait(120).then(() => {
      if (!chatFooterRef.current) return;
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
    });
  }, [refreshChatPageAfterKeyboardChange, wait]);

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


 return { keyboardLayoutMode, chatPanelStyle, chatMessagesRef, messagesStyle, floatingContactActionsVisible, floatingContactActionsStyle, overlayComposerDocked, pageComposerDocked, chatFooterStyle, hideContactDetails, hideMainComposer, chatFooterRef, contactFormRef, inputRef, focusFooterInput, clearFooterFocusAfterBlur, scrollTranscriptToEnd, isTranscriptNearEnd, onComposerPointerDown: () => { keyboardViewportBaselineRef.current ??= getKeyboardViewportBaselineHeight(); } };
}
