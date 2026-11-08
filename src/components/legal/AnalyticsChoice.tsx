'use client';

import { useState } from 'react';
import { clearMarketingStorage, setConsent } from '@/lib/marketing/capture';

/** Opt-out: forgets the visitor key, stops PostHog in this browser, then reloads without either. */
export function AnalyticsChoice() {
  const [saved, setSaved] = useState(false);
  async function optOut() {
    setConsent('no');
    clearMarketingStorage();
    setSaved(true);
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
  return <button className="mt-2 underline" onClick={() => void optOut()}>{saved ? 'Measurement turned off' : 'Turn off measurement'}</button>;
}
