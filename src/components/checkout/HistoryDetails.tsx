"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { OrderId } from "./backend";

/** Keep opened subscriptions and cursors alive until a different order is selected. */
export function HistoryDetails({ orderId, ...props }: { orderId: OrderId; title: string; children: ReactNode }) {
  return <DeferredDetails key={orderId} {...props} />;
}

function DeferredDetails({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  // Disclosures stack as one ruled list (see PaymentRecord's "Receipt activity").
  return <details className="group/details w-full border-t border-border text-sm print:hidden" onToggle={event => {
    if (event.currentTarget.open) setExpanded(true);
  }}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded py-2 font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90" />{title}</summary>
    {expanded ? children : null}
  </details>;
}
