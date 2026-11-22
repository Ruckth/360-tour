/** Public routes live at the origin root, including when a deployment supplied a webhook URL. */
export function siteUrl() {
  const configured = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return "https://tour.helpgueststay.com";
  const url = URL.parse(configured);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error("The public site URL must be an HTTP or HTTPS origin");
  }
  return url.origin;
}
