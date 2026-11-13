import { useSyncExternalStore } from "react";

// Browser fixtures run outside Next: the page's `path` query parameter stands in for the route,
// and every other query parameter for its search params. Navigation is recorded, not performed,
// unless a fixture opts in with enableLiveNavigation(): then router.replace/push update the
// search params the page reads, so URL-driven screens (Chats, Questions) can be driven end to end.
const initialParams = new URLSearchParams(location.search);
const pathname = initialParams.get("path") ?? "/";
let live = false;
let currentParams = initialParams;
const listeners = new Set<() => void>();

export function enableLiveNavigation() {
  live = true;
}

function navigate(href: string) {
  document.body.dataset.navigation = href;
  window.dispatchEvent(new CustomEvent("fixture-navigation", { detail: href }));
  if (!live) return;
  currentParams = new URL(href, location.origin).searchParams;
  listeners.forEach((listener) => listener());
}
const router = { push: navigate, replace: navigate, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => undefined };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const readParams = () => currentParams;

export function usePathname() {
  return pathname;
}
export function useSearchParams() {
  return useSyncExternalStore(subscribe, readParams, readParams);
}
export function useRouter() {
  return router;
}
export function useParams() {
  return {};
}
export function useSelectedLayoutSegment() {
  return null;
}
// next-intl's navigation helpers (`@/i18n/navigation`) import these; fixtures never redirect.
export function redirect(href: string): never {
  navigate(href);
  throw new Error(`redirect(${href}) in a browser fixture`);
}
export const permanentRedirect = redirect;
