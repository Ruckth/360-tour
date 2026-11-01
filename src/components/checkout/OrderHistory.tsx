"use client";

import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCheckoutBackend, type OrderId } from "./backend";
import { InlineErrorBoundary } from "./ErrorBoundary";

export const historyTime = (at: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
const labels: Record<string, string> = {
  line_added: "Item added",
  line_updated: "Item changed",
  line_removed: "Item removed",
  cleared: "Order cleared",
  source_attached: "Booking attached",
  customer_merged: "Customer references merged",
  discarded: "Order discarded",
  restored: "Order restored",
};
const fields: Record<string, string> = {
  name: "Item",
  detail: "Details",
  kind: "Type",
  qty: "Quantity",
  unitPrice: "Unit price",
  currency: "Currency",
  deposit: "Paid before checkout",
  staffId: "Staff reference",
  startAt: "Service date",
  serviceId: "Service reference",
  propertyId: "Villa reference",
  bookingId: "Stay reference",
  appointmentId: "Appointment reference",
  customerId: "Customer reference",
  status: "Status",
  guestName: "Guest",
  guestPhone: "Phone",
  guestEmail: "Email",
  hasItems: "Has items",
  itemCount: "Items",
  total: "Total",
  due: "Due",
};

/** Business fields only. Unknown metadata is never dumped into the UI. Empty strings are explicit. */
export function HistoryValues({
  value,
  previous,
}: {
  value: unknown;
  previous?: unknown;
}) {
  if (!value || typeof value !== "object") return null;
  const row = { ...(value as Record<string, unknown>) };
  if (previous && typeof previous === "object")
    for (const key of Object.keys(previous)) {
      if (
        (key in fields || key === "discount" || key === "priceOverride") &&
        !Object.hasOwn(row, key)
      )
        row[key] = null;
    }
  const lines = Array.isArray(row.lines) ? row.lines : [];
  return (
    <div className="grid gap-1 text-xs [overflow-wrap:anywhere]">
      {Object.entries(fields)
        .filter(([key]) => Object.hasOwn(row, key))
        .map(([key, label]) => {
          const value = row[key];
          const formatted =
            value === null || value === undefined || value === ""
              ? "Cleared"
              : typeof value === "boolean"
                ? value
                  ? "Yes"
                  : "No"
                : typeof value === "number" && key === "startAt"
                  ? historyTime(value)
                  : typeof value === "number" &&
                      ["unitPrice", "deposit", "total", "due"].includes(key)
                    ? formatMoney(value)
                    : String(value);
          return (
            <p key={key}>
              <span className="font-medium">{label}:</span> {formatted}
            </p>
          );
        })}
      {row.discount === null ? <p>Discount: Cleared</p> : null}
      {row.priceOverride === null ? <p>Price override: Cleared</p> : null}
      {row.discount && typeof row.discount === "object" ? (
        <p>
          Discount: {String((row.discount as Record<string, unknown>).value)}{" "}
          {(row.discount as Record<string, unknown>).type === "percent"
            ? "%"
            : "THB"}
        </p>
      ) : null}
      {row.priceOverride && typeof row.priceOverride === "object" ? (
        <p>
          Price override:{" "}
          {formatMoney(
            Number((row.priceOverride as Record<string, unknown>).price),
          )}{" "}
          · {String((row.priceOverride as Record<string, unknown>).note ?? "")}
        </p>
      ) : null}
      {lines.length ? (
        <ul className="grid gap-2">
          {lines.map((line, index) => (
            <li key={index}>
              <HistoryValues value={line} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function OrderHistory({ orderId }: { orderId: OrderId }) {
  return (
    <details className="w-full text-sm print:hidden">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
        Order history
      </summary>
      <InlineErrorBoundary
        resetKey={orderId}
        message="Couldn't load order history. Retry to continue."
      >
        <HistoryPage orderId={orderId} />
      </InlineErrorBoundary>
    </details>
  );
}
function HistoryPage({ orderId }: { orderId: OrderId }) {
  const page = useCheckoutBackend().useOrderHistory(orderId);
  return (
    <section aria-label="Order history" className="grid gap-3 pb-3">
      <p className="text-xs text-muted-foreground">
        Newly recorded item changes, including removed contents. Earlier changes
        may not have been recorded. All times are Bangkok time.
      </p>
      {page.status === "LoadingFirstPage" ? (
        <Spinner label="Loading order history" />
      ) : null}
      {!page.results.length && page.status === "Exhausted" ? (
        <p className="text-sm text-muted-foreground">
          No recorded item changes.
        </p>
      ) : null}
      <ol className="grid gap-4">
        {page.results.map((entry) => (
          <li
            key={entry._id}
            className="grid gap-1 border-b border-border pb-3"
          >
            <p className="font-medium">
              {labels[entry.kind] ?? entry.kind.replaceAll("_", " ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {entry.actor} · Recorded {historyTime(entry.recordedAt)}
              <br />
              Effective {historyTime(entry.effectiveAt)}
            </p>
            {entry.reason ? <p>{entry.reason}</p> : null}
            {entry.before !== undefined ? (
              <div>
                <p className="text-xs font-semibold">
                  Before{entry.kind === "cleared" ? " · removed contents" : ""}
                </p>
                <HistoryValues value={entry.before} />
              </div>
            ) : null}
            {entry.after !== undefined ? (
              <div>
                <p className="text-xs font-semibold">After</p>
                <HistoryValues value={entry.after} previous={entry.before} />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {page.status === "CanLoadMore" || page.status === "LoadingMore" ? (
        <Button
          variant="outline"
          disabled={page.status === "LoadingMore"}
          onClick={() => page.loadMore(20)}
        >
          {page.status === "LoadingMore"
            ? "Loading older changes…"
            : "Load older order changes"}
        </Button>
      ) : null}
    </section>
  );
}
