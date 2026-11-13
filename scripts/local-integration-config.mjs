/** Never let Next's dotenv loader restore external-provider or deployment credentials. */
export const disabledServiceKeys = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SERVER_SECRET",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "PUBLIC_CONVEX_URL",
  "PUBLIC_CLERK_PUBLISHABLE_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "FACEBOOK_ACCESS_TOKEN",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_VERIFY_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_VERIFY_TOKEN",
  "META_APP_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "AI_API_KEY",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OWNER_NOTIFICATION_EMAIL",
];
export const disabledServices = Object.fromEntries(
  disabledServiceKeys.map((key) => [key, ""]),
);
/** @param {string} value */
export function requireLocalBackend(value) {
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.protocol !== "http:"
  )
    throw new Error(
      "Integration backend must be an isolated local HTTP server",
    );
  return value;
}
