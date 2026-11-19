"use client";

import { Card } from "@/components/ui/card";
import { useNow } from "@/lib/staff-bookings";
import { useCheckoutBackend, type AdjustKind, type AdjustTarget, type ApprovalId, type OrderId } from "./backend";
import { useCommerceCopy } from "./commerce-copy";
import { minutesLeft, personName } from "./staff-approvals";

/**
 * A request about an item rather than an order total (W1·L3's staffApprovals.pendingPage and
 * detail): a return of items, or an edit to a sold or catalogue item (D19). `revisions` is what the
 * cashier saw against what the item is now; any difference makes the request stale.
 */
export type TargetApproval = {
  _id: ApprovalId;
  kind: "returnItems" | "adjustment";
  requesterEmail: string;
  reason: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "stale";
  /** An edit's item; null for a return, which is about its receipt. */
  target: AdjustTarget | null;
  adjustmentKind: AdjustKind | null;
  /** The item as staff know it ("Massage 5 · Maya Lin"), from the request's detail; null until read. */
  targetLabel: string | null;
  orderId: OrderId | null;
  /** A return's total. */
  amount: number | null;
  revisions: { expected: number; current: number | null }[];
};

export const isStale = (request: Pick<TargetApproval, "status" | "revisions">) =>
  request.status === "stale" || request.revisions.some((revision) => revision.current !== revision.expected);

/** One target-scoped request in the Approvals panel. Approving opens with returns and edits (W2B+). */
export default function TargetApprovalItem({ request }: { request: TargetApproval }) {
  const copy = useCommerceCopy();
  const order = useCheckoutBackend().useOrder(request.orderId);
  const now = useNow(10_000);
  const stale = isStale(request);
  const changed = request.revisions.find((revision) => revision.current !== revision.expected);
  const targetName = request.target ? copy.t(`approvals.targets.${request.target.targetType}`) : null;
  const ask = request.kind === "returnItems"
    ? copy.t("approvals.returnItems", { amount: copy.money(request.amount ?? 0) })
    : copy.t("approvals.edit", { what: copy.t(`approvals.what.${request.adjustmentKind ?? "editCatalogue"}`), target: request.targetLabel ?? targetName ?? "" });
  const soon = request.expiresAt - now <= 2 * 60_000;
  return (
    <li data-testid="approval-request" data-approval-scope="target">
      <Card className="grid gap-2 p-4">
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {[request.kind === "returnItems" ? copy.t("buttons.returnItems") : targetName, order?.order.title].filter(Boolean).join(" · ")}
        </p>
        <p className="text-[15px] font-semibold text-balance [overflow-wrap:anywhere]">{personName(request.requesterEmail)} {ask}</p>
        <blockquote data-sentence-budget="ignore" className="border-l-2 border-gold/60 pl-3 text-sm text-muted-foreground italic [overflow-wrap:anywhere]">“{request.reason}”</blockquote>
        {stale ? (
          <div className="grid gap-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200" data-testid="approval-stale">
            <p className="font-medium">{copy.t("approvals.stale")}</p>
            <p>{copy.t("approvals.staleHelp")}</p>
            {changed ? <p className="text-xs tabular-nums">{copy.t("approvals.revision", { expected: changed.expected, current: changed.current ?? "–" })}</p> : null}
          </div>
        ) : null}
        <p className={soon ? "text-xs text-amber-800 dark:text-amber-300" : "text-xs text-muted-foreground"}>
          {now >= request.expiresAt ? "Expiring now" : `Expires in ${minutesLeft(request.expiresAt, now)} min`}
        </p>
        <p className="text-xs text-muted-foreground">{copy.t("approvals.notYet")}</p>
      </Card>
    </li>
  );
}
