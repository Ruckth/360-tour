"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { localizeHref } from '@/i18n/routing';
import { analyticsRoute } from '@/lib/marketing/analytics';
import { isUntrackedPath, onConsentChange, readConsent, setConsent } from '@/lib/marketing/capture';

/**
 * Tells PostHog which page is showing, on every route (staff ones are never measured), and asks for the
 * measurement choice on guest pages. Capture and withdrawal are handled in lib/marketing.
 */
export function AnalyticsConsent() {
  const pathname = usePathname();
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  useEffect(() => analyticsRoute(pathname, key ? { key, host } : null), [pathname, key, host]);
  // Never on staff screens or the counter display: those aren't visitors.
  if (isUntrackedPath(pathname)) return null;
  return <AnalyticsConsentBanner />;
}

function AnalyticsConsentBanner() {
  const t = useTranslations('Consent');
  const locale = useLocale();
  // undefined until the browser has been read, so nobody who already answered sees the banner flash.
  const choice = useSyncExternalStore(onConsentChange, readConsent, () => undefined);
  if (choice !== null) return null;
  return <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg rounded-xl border border-border bg-card p-4 text-sm text-card-foreground shadow-xl" role="dialog" aria-label={t('label')}>
    <p className="leading-relaxed">{t('message')}</p>
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <Link className="me-auto text-muted-foreground underline underline-offset-2 hover:text-foreground" href={localizeHref('/privacy', locale)}>{t('details')}</Link>
      <Button variant="outline" onClick={() => setConsent('no')}>{t('decline')}</Button>
      <Button onClick={() => setConsent('yes')}>{t('accept')}</Button>
    </div>
  </div>;
}
