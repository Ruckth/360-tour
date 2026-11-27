/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
}

declare module "virtual:start-tour-module-preloads" {
  const preloads: Record<"three" | "pannellum", readonly string[]>;
  export default preloads;
}
