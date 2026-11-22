import { useRouter as useTanstackRouter, useRouterState, type AnyRouter } from "@tanstack/react-router";
import { useMemo } from "react";

type NavigationOptions = { scroll?: boolean };

export function usePathname() {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function useSearchParams() {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useSelectedLayoutSegment(parentPath: string) {
  const pathname = usePathname();
  const prefix = parentPath + "/";
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/")[0] || null : null;
}

export function useRouter() {
  const router = useTanstackRouter<AnyRouter>();
  return useMemo(() => {
    function navigate(href: string, replace: boolean, options: NavigationOptions = {}) {
      void router.navigate({
        href,
        replace,
        resetScroll: options.scroll,
        hashScrollIntoView: options.scroll,
      });
    }

    return {
      push: (href: string, options?: NavigationOptions) => navigate(href, false, options),
      replace: (href: string, options?: NavigationOptions) => navigate(href, true, options),
      prefetch(href: string) {
        const url = new URL(href, router.origin);
        if (url.origin !== router.origin) return;
        void router.preloadRoute({ to: url.pathname, href: url.pathname + url.search + url.hash });
      },
    };
  }, [router]);
}
