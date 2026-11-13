"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import Link from "next/link";
import { formatReceiptNumber } from "convex/shared/orderMath";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orderPath, receiptPath } from "@/components/checkout/checkout-source";
import { formatMoney } from "./labels";

type Source = { bookingId: Id<"bookings"> } | { appointmentId: Id<"appointments"> };

const STATE_LABELS = { unpaid: "Unpaid", paid: "Paid", void: "Voided", discarded: "Discarded" } as const;

/**
 * A booking's or appointment's orders in its detail sheet: total, paid (net of recorded refunds)
 * and balance or credit, the open order (Open order reuses it, from any device) and recent paid
 * orders with their receipts, refunds against them and whether they were corrected. Receipts
 * themselves stay as issued. `closed` (cancelled or refunded) hides the actions that would start
 * charging it.
 */
export function BookingOrders({ source, currency, closed }: { source: Source; currency: string; closed: boolean }) {
  const summary = useQuery(api.pos.orders.ordersForBooking, source);
  const openHref = "bookingId" in source ? `/admin/checkout?booking=${source.bookingId}` : `/admin/checkout?appointment=${source.appointmentId}`;

  if (summary === undefined) return <Skeleton className="h-16 w-full" aria-label="Loading orders" />;
  if (summary === null) return <p className="text-sm text-muted-foreground">Not found.</p>;
  const { balance, activeOrder, orders } = summary;
  const history = orders.filter((order) => order._id !== activeOrder?._id);

  return (
    <div className="grid gap-2 text-sm">
      <p>
        Total {formatMoney(balance.total, currency)} · Paid {formatMoney(balance.paid, currency)}
        {balance.refunded > 0 ? ` (after ${formatMoney(balance.refunded, currency)} refunded)` : ""} ·{" "}
        <span className="font-medium">
          {balance.credit > 0 && !closed ? `Credit ${formatMoney(balance.credit, currency)}` : `Balance ${formatMoney(balance.owed, currency)}`}
        </span>
      </p>
      {closed ? null : activeOrder ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Opening by booking charges what it still owes on that same order. */}
          <ButtonLink href={balance.owed > 0 ? openHref : orderPath(activeOrder._id)} size="sm">
            Open {activeOrder.title}
          </ButtonLink>
          <span className="text-muted-foreground">{activeOrder.due > 0 ? `${formatMoney(activeOrder.due, currency)} due` : "Nothing charged yet"}</span>
        </div>
      ) : (
        <ButtonLink href={openHref} size="sm" variant={balance.owed > 0 ? "default" : "outline"} className="justify-self-start">
          {balance.owed > 0 ? "Open order" : "New order for extras"}
        </ButtonLink>
      )}
      {history.length ? (
        <ul className="grid gap-1">
          {history.map((order) => (
            <li key={order._id} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
              <Link className="underline-offset-2 hover:underline" href={order.state === "unpaid" ? orderPath(order._id) : receiptPath(order._id)}>
                {order.title}
                {order.receiptNumber !== undefined ? ` · ${formatReceiptNumber(order.receiptNumber)}` : ""}
              </Link>
              <span>
                {order.voidUnreceived ? "Voided, no money received" : STATE_LABELS[order.state]} · {formatMoney(order.total, currency)}
                {order.refunded > 0 ? ` · ${formatMoney(order.refunded, currency)} refunded` : ""}
                {order.corrected && !order.voidUnreceived ? " · corrected" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.discardedOrders.length ? <ul className="grid gap-1" aria-label="Discarded orders">
        {summary.discardedOrders.map(order => <li key={order._id} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
          <Link className="underline-offset-2 hover:underline" href={orderPath(order._id)}>{order.title} · Discarded</Link>
          <span>{order.discardReason ?? "Contents kept; open to restore"}</span>
        </li>)}
      </ul> : null}
    </div>
  );
}
