'use client';

import { useSyncExternalStore } from 'react';
import { clearMarketingStorage, onConsentChange, readConsent, setConsent } from '@/lib/marketing/capture';

/**
 * The measurement choice on the privacy page: says whether it is on in this browser and switches it.
 * Turning it off forgets the visitor key, stops PostHog here, then reloads without either.
 */
export function AnalyticsChoice() {
  // undefined until the browser has been read.
  const choice = useSyncExternalStore(onConsentChange, readConsent, () => undefined);
  async function optOut() {
    setConsent('no');
    clearMarketingStorage();
    try {
      const { default: posthog } = await import('posthog-js');
      if (posthog.__loaded) {
        posthog.opt_out_capturing();
        posthog.reset();
      }
    } catch {
      // PostHog never loaded here; nothing to stop.
    }
    window.location.reload();
  }
  if (choice === undefined) return null;
  const on = choice === 'yes';
  return (
    <p className="mt-2">
      Measurement is {on ? 'on' : 'off'} in this browser.{' '}
      <button className="underline" onClick={() => (on ? void optOut() : setConsent('yes'))}>
        {on ? 'Turn off measurement' : 'Turn on measurement'}
      </button>
    </p>
  );
}
