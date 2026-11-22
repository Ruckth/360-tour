import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

const siteRequests = createMiddleware().server(async ({ next, request, handlerType }) => {
  if (handlerType === "router") {
    const { siteRedirect } = await import("./site-redirect.server");
    if (process.env.VERCEL_ENV === "preview") {
      const { setResponseHeader } = await import("@tanstack/react-start/server");
      if (process.env.START_VERIFY_PROVIDER_ISOLATION === "1") {
        const { default: disabledProviderKeys } = await import("@/lib/server/disabled-provider-keys.json");
        if (disabledProviderKeys.some((key) => process.env[key])) {
          return new Response("Preview fixture unavailable", { status: 503 });
        }
        setResponseHeader("x-start-provider-isolation", "verified");
      }
      const versions = process.versions;
      setResponseHeader("x-start-runtime", versions.bun ? `bun/${versions.bun}` : `node/${versions.node}`);
    }
    const redirect = await siteRedirect(request);
    if (redirect) return redirect;
  }
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === "serverFn" }),
    clerkMiddleware({ publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY }),
    siteRequests,
  ],
}));
