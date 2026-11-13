"use client";

import type { ReactNode } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import type { OrderId } from "./backend";

/** Keep opened subscriptions and cursors alive until a different order is selected. */
export function HistoryDetails({ orderId, ...props }: { orderId: OrderId; title: string; hint?: string; children: ReactNode }) {
  return <DeferredDetails key={orderId} {...props} />;
}

function DeferredDetails({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  // Disclosures stack as one ruled list (see PaymentRecord's "Receipt activity").
  return (
    <Disclosure label={title} hint={hint} lazy="first-open" className="border-t border-border print:hidden" contentClassName="pb-0">
      {children}
    </Disclosure>
  );
}
