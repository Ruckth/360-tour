"use client";

import { api } from 'convex/_generated/api';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { CONSENT_EVENT, capturePageView, isUntrackedPath } from '@/lib/marketing/capture';
import { useConvex } from 'convex/react';

/** Release 3a: notes the link that brought this tab and, after consent, keeps the visit session going. */
export function MarketingCapture() {
  const pathname = usePathname();
  const convex = useConvex();

  useEffect(() => {
    if (isUntrackedPath(pathname)) return;
    const run = () => void capturePageView((args) => convex.mutation(api.marketing.public.startSession, args));
    run();
    window.addEventListener(CONSENT_EVENT, run);
    return () => window.removeEventListener(CONSENT_EVENT, run);
  }, [pathname, convex]);

  return null;
}
