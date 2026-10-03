import { createHash } from "node:crypto";

// Empty strings prevent Next's dotenv loader from restoring configured services.
export const disabledDemoKeys = [
  "CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SERVER_SECRET",
  "NEXT_PUBLIC_CONVEX_SITE_URL", "CLERK_SECRET_KEY",
  "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST",
  "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN",
  "FACEBOOK_ACCESS_TOKEN", "FACEBOOK_APP_SECRET", "FACEBOOK_VERIFY_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_VERIFY_TOKEN",
  "META_APP_SECRET", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
  "AI_API_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
];

const demoOverrides = {
  ...Object.fromEntries(disabledDemoKeys.map((key) => [key, ""])),
  NEXT_PUBLIC_CONVEX_URL: "placeholder",
  PUBLIC_CONVEX_URL: "placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "placeholder",
  PUBLIC_CLERK_PUBLISHABLE_KEY: "placeholder",
  NEXT_TELEMETRY_DISABLED: "1",
};

/** @param {NodeJS.ProcessEnv} source @param {string} port */
export function createDemoEnv(source, port) {
  return { ...source, ...demoOverrides, PORT: port };
}

const configHash = createHash("sha256").update(JSON.stringify(demoOverrides)).digest("hex");

/** @param {string} buildId */
export function demoBuildStamp(buildId) {
  return JSON.stringify({ version: 1, buildId: buildId.trim(), configHash });
}

/** @param {string | null} marker @param {string | null} buildId */
export function canReuseDemoBuild(marker, buildId) {
  return Boolean(buildId?.trim() && marker === demoBuildStamp(buildId));
}
