"use client";

import { useState, type ReactNode } from "react";
import type { OrderId } from "./backend";

/** Keep opened subscriptions and cursors alive until a different order is selected. */
export function HistoryDetails({ orderId, ...props }: { orderId: OrderId; title: string; children: ReactNode }) {
  return <DeferredDetails key={orderId} {...props} />;
}

function DeferredDetails({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="w-full text-sm print:hidden" onToggle={event => {
    if (event.currentTarget.open) setExpanded(true);
  }}>
    <summary className="min-h-11 cursor-pointer py-3 font-semibold">{title}</summary>
    {expanded ? children : null}
  </details>;
}
