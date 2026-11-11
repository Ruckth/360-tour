'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { isConsentPageOnly, onConsentChange, readConsent, setConsent } from '@/lib/marketing/capture';

/**
 * The measurement choice on the privacy page: says whether it is on and switches it. Turning it off
 * forgets the visitor key and stops PostHog in every open tab, with no reload (lib/marketing/capture).
 * When the browser won't save the choice, it says the choice holds for this page only.
 */
export function AnalyticsChoice() {
  const t = useTranslations('Legal.choice');
  // undefined until the browser has been read.
  const choice = useSyncExternalStore(onConsentChange, readConsent, () => undefined);
  const pageOnly = useSyncExternalStore(onConsentChange, isConsentPageOnly, () => false);
  if (choice === undefined) return null;
  const on = choice === 'yes';
  const status = pageOnly ? (on ? 'pageOnlyOn' : 'pageOnlyOff') : (on ? 'on' : 'off');
  return (
    <p className="mt-2">
      {t(status)}{' '}
      <button className="underline" onClick={() => setConsent(on ? 'no' : 'yes')}>
        {t(on ? 'turnOff' : 'turnOn')}
      </button>
    </p>
  );
}
