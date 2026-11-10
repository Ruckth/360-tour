'use client';

import { useSyncExternalStore } from 'react';
import { isConsentPageOnly, onConsentChange, readConsent, setConsent } from '@/lib/marketing/capture';

/**
 * The measurement choice on the privacy page: says whether it is on and switches it. Turning it off
 * forgets the visitor key and stops PostHog in every open tab, with no reload (lib/marketing/capture).
 * When the browser won't save the choice, it says the choice holds for this page only.
 */
export function AnalyticsChoice() {
  // undefined until the browser has been read.
  const choice = useSyncExternalStore(onConsentChange, readConsent, () => undefined);
  const pageOnly = useSyncExternalStore(onConsentChange, isConsentPageOnly, () => false);
  if (choice === undefined) return null;
  const on = choice === 'yes';
  return (
    <p className="mt-2">
      {pageOnly
        ? `Measurement is ${on ? 'on' : 'off'} for this page only: this browser isn’t letting the site save the choice, so other tabs and later visits won’t know it.`
        : `Measurement is ${on ? 'on' : 'off'} in this browser.`}{' '}
      <button className="underline" onClick={() => setConsent(on ? 'no' : 'yes')}>
        {on ? 'Turn off measurement' : 'Turn on measurement'}
      </button>
    </p>
  );
}
