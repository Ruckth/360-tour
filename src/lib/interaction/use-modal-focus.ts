"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

let sharedTourOpener: HTMLElement | null = null;

/**
 * Contains keyboard focus inside a modal dialog container, moves focus inside when active,
 * and restores focus to the triggering opener once the last tour dialog closes.
 */
export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  focusTriggerKey?: string | number,
) {
  const capturedOpener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const currentActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const insideAnyTourDialog = currentActive?.closest('[data-tour-dialog="true"]');
    if (currentActive && currentActive !== document.body && !insideAnyTourDialog) {
      sharedTourOpener = currentActive;
      capturedOpener.current = currentActive;
    } else if (!capturedOpener.current && sharedTourOpener) {
      capturedOpener.current = sharedTourOpener;
    }

    function moveFocusInside() {
      const node = containerRef.current;
      if (!node) return;
      if (node.contains(document.activeElement)) return;
      const focusable = getFocusableElements(node);
      const preferred = focusable.find((el) => el.hasAttribute("autofocus")) ?? focusable[0] ?? node;
      preferred.focus({ preventScroll: true });
    }

    moveFocusInside();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;
      const focusable = getFocusableElements(node);
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeEl || !node.contains(activeEl) || activeEl === first || activeEl === node) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else if (!activeEl || !node.contains(activeEl) || activeEl === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus only when no tour dialog remains open (e.g. loading -> active swaps smoothly).
      queueMicrotask(() => {
        if (document.querySelector('[data-tour-dialog="true"]')) return;
        const opener = capturedOpener.current ?? sharedTourOpener;
        sharedTourOpener = null;
        capturedOpener.current = null;
        if (opener && opener.isConnected) {
          opener.focus({ preventScroll: true });
        }
      });
    };
  }, [active, containerRef, focusTriggerKey]);
}
