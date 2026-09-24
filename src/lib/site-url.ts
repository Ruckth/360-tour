export function siteUrl() {
  const configured = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return (configured || 'https://tour.helpgueststay.com').replace(/\/+$/, '');
}
