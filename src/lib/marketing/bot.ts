/** Common search crawlers and social/messaging link-preview fetchers.
 * Not `Line/`: that is LINE's in-app browser, i.e. a real guest. Its preview fetcher is `line-poker`. */
export function isMarketingBot(userAgent: string | null | undefined): boolean {
  return /bot|crawler|spider|facebookexternalhit|preview|WhatsApp|line-poker/i.test(userAgent ?? "");
}
