"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "iframe", "[tabindex]",
].join(", ");

function getFocusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled")) return false;
    if (element.closest("[hidden], [inert], [aria-hidden=true]")) return false;
    return window.getComputedStyle(element).visibility === "visible" && element.getClientRects().length > 0;
  });
}

export function useTourOpener(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const trigger = opener.current;
    opener.current = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, [open]);
  return (trigger: HTMLElement) => { opener.current = trigger; };
}

export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  focusTriggerKey?: string,
) {
  useEffect(() => {
    const node = containerRef.current;
    if (!active || !node) return;
    const container = node;

    function moveFocusInside() {
      const [first] = getFocusableElements(container);
      (first ?? container).focus({ preventScroll: true });
    }

    if (!getFocusableElements(container).some((element) => element === document.activeElement)) {
      moveFocusInside();
    }

    function onFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && !container.contains(event.target)) moveFocusInside();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const focusable = getFocusableElements(container);
      const current = document.activeElement;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey ? current === first : current === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      } else if (!focusable.some((element) => element === current)) {
        event.preventDefault();
        ((event.shiftKey ? last : first) ?? container).focus({ preventScroll: true });
      }
    }

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, containerRef, focusTriggerKey]);
}
