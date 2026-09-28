import { useEffect } from "react";

export const UNSAVED_CHANGES_MESSAGE = "Discard unsaved changes?";

let dirtyEditors = 0;

/** True while any mounted editor has unsaved changes, for in-app navigation that isn't a link (e.g. tab buttons). */
export function hasUnsavedChanges() {
  return dirtyEditors > 0;
}

/** A same-tab link to another page of this site: the click a client-side router would handle. */
export function isInAppNavigation(event: MouseEvent, anchor: HTMLAnchorElement, current: Location) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return false;
  const url = new URL(anchor.href, current.href);
  return url.origin === current.origin && (url.pathname !== current.pathname || url.search !== current.search);
}

/**
 * While `dirty`, asks before leaving: reloads and closing the tab get the browser prompt,
 * in-app links (e.g. the sidebar) a confirm. Tab buttons check `hasUnsavedChanges()`.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    dirtyEditors += 1;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Capture phase on the document runs before React's root listener, so a cancelled click never reaches next/link.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || !isInAppNavigation(event, anchor, window.location)) return;
      if (window.confirm(UNSAVED_CHANGES_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      dirtyEditors -= 1;
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
