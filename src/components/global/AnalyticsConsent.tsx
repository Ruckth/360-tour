"use client";

import Link from '@/platform/link';
import { usePathname } from '@/platform/navigation';
import { useLocale, useTranslations } from '@/platform/intl';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { localizeHref, stripLocalePrefix } from '@/i18n/routing';
import { focusGuestAfterConsent } from '@/lib/guest-bottom-inset';
import { analyticsRoute } from '@/lib/marketing/analytics';
import { isUntrackedPath, onConsentChange, readConsent, setConsent } from '@/lib/marketing/capture';
import { cn } from '@/lib/utils';

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
  const page = stripLocalePrefix(pathname).replace(/\/$/, "");
  // These pages place the same choice in the flow, beside the relevant guest controls.
  if (page === "" || page === "/booking" || page === "/chat" || page === "/privacy") return null;
  return <AnalyticsConsentChoice />;
}

export function AnalyticsConsentChoice({
  inline = false,
  className,
  onDecision = focusGuestAfterConsent,
}: {
  inline?: boolean;
  className?: string;
  onDecision?: () => void;
}) {
  const t = useTranslations('Consent');
  const locale = useLocale();
  // undefined until the browser has been read, so nobody who already answered sees the banner flash.
  const choice = useSyncExternalStore(onConsentChange, readConsent, () => undefined);
  if (choice !== null) return null;
  function choose(next: 'yes' | 'no') {
    onDecision();
    setConsent(next);
  }
  return <div
    className={cn(
      "rounded-xl border border-border bg-card p-3 text-sm text-card-foreground sm:p-4",
      !inline && "fixed inset-x-4 z-50 mx-auto max-h-[calc(100dvh-var(--guest-bottom-clearance,1rem)-2rem)] max-w-lg overflow-y-auto shadow-xl",
      className,
    )}
    style={inline ? undefined : { bottom: 'max(calc(1rem + env(safe-area-inset-bottom, 0px)), var(--guest-bottom-clearance, 0px))' }}
    role={inline ? "region" : "dialog"}
    aria-label={t('label')}
  >
    <p className="leading-relaxed">{t('message')}</p>
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <Link className="me-auto inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-2 hover:text-foreground" href={localizeHref('/privacy', locale)}>{t('details')}</Link>
      <Button size="sm" variant="outline" onClick={() => choose('no')}>{t('decline')}</Button>
      <Button size="sm" onClick={() => choose('yes')}>{t('accept')}</Button>
    </div>
  </div>;
}
