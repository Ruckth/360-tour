import { createRouter } from "@tanstack/react-router";
import { parseUrlSearch, stringifyUrlSearch } from "./platform/search";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, defaultPreload: "intent", parseSearch: parseUrlSearch, stringifySearch: stringifyUrlSearch });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
