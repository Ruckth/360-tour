'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { localizeHref } from '@/i18n/routing';
import { isUntrackedPath, onConsentChange, readConsent, setConsent } from '@/lib/marketing/capture';

/** Never on staff screens or the counter display: those aren't visitors. */
export function AnalyticsConsent() {
  const pathname = usePathname();
  if (isUntrackedPath(pathname)) return null;
  return <AnalyticsConsentBanner pathname={pathname} />;
}

function AnalyticsConsentBanner({ pathname }: { pathname: string }) {
  const t = useTranslations('Consent');
  const locale = useLocale();
  // undefined until the browser has been read, so nobody who already answered sees the banner flash.
  const choice = useSyncExternalStore(onConsentChange, readConsent, () => undefined);
  const [ready, setReady] = useState(false);
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  useEffect(() => {
    if (choice !== 'yes' || !key) return;
    let active = true;
    void import('posthog-js').then(({ default: posthog }) => {
      if (!active) return;
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        person_profiles: 'identified_only',
      });
      setReady(true);
    });
    return () => { active = false; };
  }, [choice, key]);

  useEffect(() => {
    if (!ready) return;
    void import('posthog-js').then(({ default: posthog }) => posthog.capture('$pageview'));
  }, [pathname, ready]);

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
