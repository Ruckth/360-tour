export type ChannelKey = "line" | "facebook" | "instagram" | "whatsapp";

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  line: "LINE",
  facebook: "Facebook Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

/** Webhook routes on the website (see DEPLOYMENT.md); paste `<site origin><path>` into each platform's console. */
export const CHANNEL_WEBHOOK_PATH: Record<ChannelKey, string> = {
  line: "/api/line/webhook",
  facebook: "/api/facebook/webhook",
  instagram: "/api/instagram/webhook",
  whatsapp: "/api/whatsapp/webhook",
};

/** Vercel env vars each channel webhook needs (see src/app/api/<channel>/webhook/route.ts). "A|B" = either. */
const CHANNEL_ENV: Record<ChannelKey, string[]> = {
  line: ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"],
  facebook: ["FACEBOOK_APP_SECRET|META_APP_SECRET", "FACEBOOK_VERIFY_TOKEN", "FACEBOOK_ACCESS_TOKEN"],
  instagram: ["INSTAGRAM_APP_SECRET|META_APP_SECRET", "INSTAGRAM_VERIFY_TOKEN", "INSTAGRAM_ACCESS_TOKEN"],
  whatsapp: ["WHATSAPP_APP_SECRET|META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_ACCESS_TOKEN"],
};

export type ChannelConfigStatus = Record<ChannelKey, { configured: boolean; vars: Record<string, boolean> }>;

/** Presence only: never returns values. */
export function channelConfigStatus(env: NodeJS.ProcessEnv = process.env): ChannelConfigStatus {
  const status = {} as ChannelConfigStatus;
  for (const channel of Object.keys(CHANNEL_ENV) as ChannelKey[]) {
    const vars: Record<string, boolean> = {};
    for (const spec of CHANNEL_ENV[channel]) {
      vars[spec.replace("|", " or ")] = spec.split("|").some((name) => Boolean(env[name]?.trim()));
    }
    status[channel] = { configured: Object.values(vars).every(Boolean), vars };
  }
  return status;
}
