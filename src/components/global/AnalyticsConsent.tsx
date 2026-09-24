'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const CONSENT_KEY = 'analytics-consent';

export function AnalyticsConsent() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<'yes' | 'no' | null>(null);
  const [ready, setReady] = useState(false);
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  useEffect(() => {
    setChoice(localStorage.getItem(CONSENT_KEY) as 'yes' | 'no' | null);
  }, []);

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

  if (!key || choice) return null;
  function save(value: 'yes' | 'no') {
    localStorage.setItem(CONSENT_KEY, value);
    setChoice(value);
  }
  return <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-border bg-card p-4 text-sm shadow-xl" role="dialog" aria-label="Analytics choice">
    <p>May we collect anonymous page views to improve this site? Analytics stays off until you agree.</p>
    <div className="mt-3 flex justify-end gap-2">
      <button className="rounded-lg border border-border px-3 py-2" onClick={() => save('no')}>No thanks</button>
      <button className="rounded-lg bg-foreground px-3 py-2 text-background" onClick={() => save('yes')}>Allow analytics</button>
    </div>
  </div>;
}
