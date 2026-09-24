'use client';

import { useState } from 'react';

export function AnalyticsChoice() {
  const [saved, setSaved] = useState(false);
  return <button className="mt-2 underline" onClick={() => {
    localStorage.setItem('analytics-consent', 'no');
    setSaved(true);
    window.location.reload();
  }}>{saved ? 'Analytics disabled' : 'Disable analytics'}</button>;
}
