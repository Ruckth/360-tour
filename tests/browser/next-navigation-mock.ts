// Browser fixtures run outside Next: the page's `path` query parameter stands in for the route,
// and every other query parameter for its search params. Navigation is recorded, not performed.
const params = new URLSearchParams(location.search);
const pathname = params.get("path") ?? "/";

function navigate(href: string) {
  document.body.dataset.navigation = href;
  window.dispatchEvent(new CustomEvent("fixture-navigation", { detail: href }));
}
const router = { push: navigate, replace: navigate, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => undefined };

export function usePathname() {
  return pathname;
}
export function useSearchParams() {
  return params;
}
export function useRouter() {
  return router;
}
export function useParams() {
  return {};
}
