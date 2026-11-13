/** Never let Next's dotenv loader restore external-provider or deployment credentials. */
export const disabledServiceKeys = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SERVER_SECRET",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_OVERRIDE_ACCESS_TOKEN",
  "CONVEX_OVERRIDE_DEPLOYMENT_URL",
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
  "MESSAGING_IMAGE_SECRET",
  "NEXT_PUBLIC_SITE_URL",
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

/**
 * Buffer complete lines so credentials split between process chunks cannot escape redaction.
 * @param {(text: string) => void} write
 * @param {(string | undefined)[]} privateValues
 */
export function createPrivateOutput(write, privateValues = []) {
  let pending = "";
  /** @param {string} value */
  function redact(value) {
    for (const secret of privateValues)
      if (secret)
        value = value
          .replaceAll(secret, "[redacted]")
          .replaceAll(encodeURIComponent(secret), "[redacted]");
    return value
      .replace(/https?:\/\/[^\s"'<>]*[?&]__clerk[^\s"'<>]*/gi, '[private Clerk browser URL]')
      .replace(/rawPacket:.*$/gm, 'rawPacket: [redacted]')
      .replace(/(View the Convex dashboard at )\S+/g, '$1[private local dashboard]')
      .replace(
        /([?&](?:__clerk_db_jwt|__clerk_ticket|__clerk_testing_token|token|guestToken|accessToken)=)[^&\s)]*/gi,
        "$1[redacted]",
      )
      .replace(
        /\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_+/=-]+/g,
        "[redacted Clerk key]",
      )
      .replace(
        /\b(?:sess|user|client|dvb)_[A-Za-z0-9]+/g,
        "[redacted Clerk identifier]",
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[redacted JWT]",
      )
      .replace(/((?:--instance-secret|--admin-key)(?:\s+|=))\S+/g, "$1[redacted]")
      .replace(/(CONVEX_(?:SELF_HOSTED_ADMIN_KEY|DEPLOY_KEY|SERVER_SECRET)\s*=\s*)\S+/g, "$1[redacted]")
      .replace(
        /(\b(?:cookie|authorization|set-cookie|guestToken|accessToken|adminKey|instanceSecret)["']?\s*[:=]\s*["'])[^"']+/gi,
        "$1[redacted]",
      )
      .replace(
        /(^|\n)(\s*(?:cookie|authorization|set-cookie)\s*:)[^\n]*/gi,
        "$1$2 [redacted]",
      )
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[redacted email]",
      );
  }
  return {
    /** @param {string} chunk */
    write(chunk) {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) write(redact(line) + "\n");
    },
    end() {
      if (pending) write(redact(pending));
      pending = "";
    },
  };
}
