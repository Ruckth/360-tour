"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Check, Pencil, Send, ShoppingCart, Undo2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows, STACKED_TABLE } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import {
  Callout,
  EditorSheet,
  FieldError,
  NoticeBar,
  NumberField,
  SheetForm,
  useNotice,
} from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { PurchaseEventHistory } from "./PurchaseEventHistory";
import {
  createOperationKey,
  ORDER_STATUS_META,
  parseStockError,
  parseWholeQuantity,
  REQUEST_STATUS_META,
  sanitizeStockReturnTo,
  stockReturnLabel,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";
import { OrderEditorSheet, RequestEditorSheet } from "./StockPurchasingHubView";

type RequestDetailResult = FunctionReturnType<typeof api.commerce.purchasing.request>;
type RequestRow = RequestDetailResult["request"];
type RequestLineRow = RequestDetailResult["lines"][number];

export function PurchaseRequestDetailView({ requestId }: { requestId: string }) {
  const { current: branch, branches, select: selectBranch } = useAdminBranch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));
  const confirm = useConfirm();
  const { notice, show, clear } = useNotice();

  const id = requestId as Id<"purchaseRequests">;
  const detail = useQuery(api.commerce.purchasing.request, { requestId: id });
  const [tab, setTab] = useState<"overview" | "history">("overview");

  const { results: events, status: historyStatus, loadMore: loadMoreHistory } = usePaginatedQuery(
    api.commerce.purchasing.history,
    branch && detail && tab === "history"
      ? { branchId: detail.request.branchId, entity: "request", entityId: detail.request._id }
      : "skip",
    { initialNumItems: 20 },
  );

  const submitReq = useMutation(api.commerce.purchasing.submitRequestForApproval);
  const withdrawReq = useMutation(api.commerce.purchasing.withdrawPendingRequest);
  const removeReq = useMutation(api.commerce.purchasing.removeRequest);
  const approveReq = useMutation(api.commerce.purchasing.approvePurchaseRequest);
  const sendBackReq = useMutation(api.commerce.purchasing.sendBackPurchaseRequest);
  const declineReq = useMutation(api.commerce.purchasing.declinePurchaseRequest);
  const closeReq = useMutation(api.commerce.purchasing.closePurchaseRequest);

  const [editOpen, setEditOpen] = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<{
    action: "send_back" | "decline" | "discard" | "close";
    revision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!branch) return null;
  if (detail === undefined) return <SkeletonRows label="Loading purchase request" rows={5} />;

  const { request, lines, orders, permissions } = detail;

  if (request.branchId !== branch.id) {
    const targetBranch = branches.find((b) => b.id === request.branchId);
    return (
      <Callout
        tone="warning"
        title="Different branch selected"
        action={
          <div className="flex flex-wrap gap-2">
            {targetBranch ? (
              <Button type="button" size="sm" onClick={() => void selectBranch(targetBranch.id)}>
                Switch to {targetBranch.name}
              </Button>
            ) : null}
            <ButtonLink href={returnTo ?? "/admin/stock/purchasing?tab=requests"} variant={targetBranch ? "outline" : "default"} size="sm">
              Back to {stockReturnLabel(returnTo, "Requests")}
            </ButtonLink>
          </div>
        }
      >
        This purchase request ({request.reference}) belongs to {targetBranch ? targetBranch.name : "another branch"}. Switch to its branch to review or act on it, or return to the list.
      </Callout>
    );
  }

  const canEdit = request.mine && (request.status === "draft" || request.status === "needs_changes");
  const canWithdraw = request.mine && request.status === "awaiting_approval";
  const canDecide = permissions.approver && !request.mine && request.status === "awaiting_approval";
  const hasAvailableForOrder = request.status === "approved" && lines.some((l) => l.available > 0);
  const canCreateOrder = permissions.buyer && hasAvailableForOrder;
  const canCloseDemand = permissions.lead && request.status === "approved";

  async function handleSubmitNow() {
    setBusy(true);
    try {
      await submitReq({
        requestId: request._id,
        expectedRevision: request.revision,
        operationKey: createOperationKey("pr-submit"),
      });
      show("Request submitted for approval.", "success");
    } catch (cause) {
      show(parseStockError(cause, "Could not submit request.").message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    setBusy(true);
    try {
      await withdrawReq({
        requestId: request._id,
        expectedRevision: request.revision,
        operationKey: createOperationKey("pr-withdraw"),
      });
      show("Request withdrawn to draft.", "success");
    } catch (cause) {
      show(parseStockError(cause, "Could not withdraw request.").message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteDraft() {
    const ok = await confirm({
      title: `Delete draft ${request.reference}?`,
      description: "This hides the draft from normal lists. History retains who deleted it and when.",
      confirmLabel: "Delete draft",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeReq({
        requestId: request._id,
        expectedRevision: request.revision,
        operationKey: createOperationKey("pr-del"),
      });
      router.push("/admin/stock/purchasing?tab=requests");
    } catch (cause) {
      show(parseStockError(cause, "Could not delete draft.").message, "danger");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href={returnTo ?? "/admin/stock/purchasing?tab=requests"} variant="ghost" size="sm" className="-ml-2">
              <ArrowLeft aria-hidden className="size-4" />
              {stockReturnLabel(returnTo, "Requests")}
            </ButtonLink>
            <span className="text-xs text-muted-foreground">· {branch.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-mono text-xl font-semibold text-foreground">{request.reference}</h2>
            <StatusBadge {...REQUEST_STATUS_META[request.status]} />
          </div>
          <p className="text-xs text-muted-foreground">
            Requested by {request.requesterLabel}
            {request.needBy ? ` · Need by ${request.needBy}` : ""}
            {" · Updated "}
            {staffDateTime(request.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <Button type="button" disabled={busy} onClick={() => void handleSubmitNow()}>
              <Send aria-hidden className="size-4" />
              {request.status === "needs_changes" ? "Resubmit" : "Submit for approval"}
            </Button>
          ) : null}
          {canEdit ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden className="size-4" />
              Edit
            </Button>
          ) : null}
          {canWithdraw ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void handleWithdraw()}>
              <Undo2 aria-hidden className="size-4" />
              Withdraw to draft
            </Button>
          ) : null}
          {canDecide ? (
            <>
              <Button type="button" disabled={busy} onClick={() => setApproveOpen(true)}>
                <Check aria-hidden className="size-4" />
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setReasonAction({ action: "send_back", revision: request.revision })}
              >
                Send back
              </Button>
            </>
          ) : null}
          {canCreateOrder ? (
            <Button type="button" onClick={() => setCreateOrderOpen(true)}>
              <ShoppingCart aria-hidden className="size-4" />
              Create order
            </Button>
          ) : null}

          <MoreMenu
            label="More request actions"
            items={[
              {
                label: "Decline request",
                hidden: !canDecide,
                destructive: true,
                onSelect: () => setReasonAction({ action: "decline", revision: request.revision }),
              },
              {
                label: "Close uncommitted demand",
                hidden: !canCloseDemand,
                destructive: true,
                onSelect: () => setReasonAction({ action: "close", revision: request.revision }),
              },
              {
                label: request.status === "needs_changes" ? "Discard request" : "Delete draft",
                hidden: !canEdit,
                destructive: true,
                onSelect: () => {
                  if (request.status === "needs_changes") {
                    setReasonAction({ action: "discard", revision: request.revision });
                  } else {
                    void handleDeleteDraft();
                  }
                },
              },
            ]}
          />
        </div>
      </div>

      {request.mine && request.status === "awaiting_approval" && permissions.approver ? (
        <Callout tone="info">
          Self-approval is disabled. Another branch approver must review this request.
        </Callout>
      ) : null}

      {request.lastReason ? (
        <Callout tone={request.status === "declined" ? "danger" : "warning"} title="Latest decision note">
          {request.lastReason}
          {request.decidedByLabel ? ` — ${request.decidedByLabel}` : ""}
        </Callout>
      ) : null}

      {request.note ? (
        <Card className="px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Requester note:</strong> {request.note}
        </Card>
      ) : null}

      <SegmentedTabs
        id="pr-detail"
        label="Purchase request tabs"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "history", label: "History" },
        ]}
      />

      {tab === "overview" ? (
        <div {...tabPanelProps("pr-detail", "overview")} className="grid gap-5">
          <Card className="overflow-hidden">
            <table className={STACKED_TABLE.table}>
              <thead className={STACKED_TABLE.head}>
                <tr>
                  <th scope="col" className={STACKED_TABLE.th}>Item</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Requested</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Approved</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Committed</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Available</th>
                </tr>
              </thead>
              <tbody className={STACKED_TABLE.body}>
                {lines.map((line) => (
                  <tr key={line._id} className={STACKED_TABLE.row}>
                    <td data-label="Item" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                      <span className="block font-medium text-foreground">{line.item.productName}</span>
                      <span className="text-xs text-muted-foreground">
                        {line.item.variantLabel}
                        {line.item.sku ? ` · ${line.item.sku}` : ""}
                      </span>
                    </td>
                    <td data-label="Requested" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.quantity}
                    </td>
                    <td data-label="Approved" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.approvedQuantity}
                    </td>
                    <td data-label="Committed" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.committedQuantity}
                    </td>
                    <td data-label="Available" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono font-semibold tabular-nums lg:text-right")}>
                      {line.available}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <section aria-label="Linked purchase orders" className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Linked orders ({orders.length})</h3>
            <Card className="overflow-hidden">
              {orders.length === 0 ? (
                <EmptyState>No purchase orders have been created from this request yet.</EmptyState>
              ) : (
                <ul className="divide-y divide-border">
                  {orders.map((po) => (
                    <li key={po._id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <Link
                          href={`/admin/stock/purchasing/orders/${po._id}`}
                          className="font-mono text-sm font-semibold text-foreground hover:underline"
                        >
                          {po.reference}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {po.supplier.name} · Ordered {po.orderedUnits} · Accepted {po.acceptedUnits} · Due {po.dueUnits}
                        </p>
                      </div>
                      <StatusBadge {...ORDER_STATUS_META[po.status]} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      ) : (
        <div {...tabPanelProps("pr-detail", "history")}>
          <Card className="p-5">
            <PurchaseEventHistory
              events={events}
              loading={historyStatus === "LoadingFirstPage"}
              hasMore={historyStatus === "CanLoadMore"}
              loadingMore={historyStatus === "LoadingMore"}
              onLoadMore={() => loadMoreHistory(20)}
            />
          </Card>
        </div>
      )}

      {editOpen ? (
        <RequestEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          liveRevision={request.revision}
          existing={{
            requestId: request._id,
            revision: request.revision,
            needBy: request.needBy,
            note: request.note,
            lines: lines.map((line) => ({
              variantId: line.variantId,
              productName: line.item.productName,
              variantLabel: line.item.variantLabel,
              sku: line.item.sku,
              quantityText: String(line.quantity),
            })),
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            show("Request updated.", "success");
          }}
        />
      ) : null}

      {createOrderOpen ? (
        <OrderEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          canAddSupplier={permissions.buyer}
          fromRequest={{
            requestId: request._id,
            reference: request.reference,
            lines: lines
              .filter((line) => line.available > 0)
              .map((line) => ({
                variantId: line.variantId,
                productName: line.item.productName,
                variantLabel: line.item.variantLabel,
                sku: line.item.sku,
                requestLineId: line._id,
                maxQuantity: line.available,
                availableQuantity: line.available,
                quantityText: String(line.available),
                unitCostText: "",
              })),
          }}
          onClose={() => setCreateOrderOpen(false)}
          onSaved={(orderId) => {
            setCreateOrderOpen(false);
            router.push(`/admin/stock/purchasing/orders/${orderId}?returnTo=${encodeURIComponent(`/admin/stock/purchasing/requests/${request._id}`)}`);
          }}
        />
      ) : null}

      {approveOpen ? (
        <ApproveRequestSheet
          request={request}
          lines={lines}
          onClose={() => setApproveOpen(false)}
          onApproved={() => {
            setApproveOpen(false);
            show("Purchase request approved.", "success");
          }}
          approveMutation={approveReq}
        />
      ) : null}

      {reasonAction ? (
        <RequestReasonActionSheet
          action={reasonAction.action}
          reference={request.reference}
          initialRevision={reasonAction.revision}
          liveRevision={request.revision}
          onClose={() => setReasonAction(null)}
          onConfirm={async (reason, expectedRevision) => {
            const opKey = createOperationKey(`pr-${reasonAction.action}`);
            if (reasonAction.action === "send_back") {
              await sendBackReq({ requestId: request._id, expectedRevision, reason, operationKey: opKey });
              show("Request sent back for changes.", "success");
            } else if (reasonAction.action === "decline") {
              await declineReq({ requestId: request._id, expectedRevision, reason, operationKey: opKey });
              show("Request declined.", "success");
            } else if (reasonAction.action === "close") {
              await closeReq({ requestId: request._id, expectedRevision, reason, operationKey: opKey });
              show("Uncommitted demand closed.", "success");
            } else {
              await removeReq({ requestId: request._id, expectedRevision, reason, operationKey: opKey });
              router.push("/admin/stock/purchasing?tab=requests");
              return;
            }
            setReasonAction(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ApproveRequestSheet({
  request,
  lines,
  onClose,
  onApproved,
  approveMutation,
}: {
  request: RequestRow;
  lines: RequestLineRow[];
  onClose: () => void;
  onApproved: () => void;
  approveMutation: (args: {
    requestId: Id<"purchaseRequests">;
    expectedRevision: number;
    lines?: { lineId: Id<"purchaseRequestLines">; approvedQuantity: number }[];
    operationKey: string;
  }) => Promise<{ id: string }>;
}) {
  const [reviewedRevision, setReviewedRevision] = useState(request.revision);
  const [initialQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line._id, String(line.quantity)])),
  );
  const [qtys, setQtys] = useState<Record<string, string>>(initialQtys);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("pr-approve"));

  const isDirty = lines.some((line) => (qtys[line._id] ?? "") !== (initialQtys[line._id] ?? ""));
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);
  const isStale = request.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const nextErrors: Record<string, string> = {};
    let firstInvalidId: string | undefined;
    const lineInputs: { lineId: Id<"purchaseRequestLines">; approvedQuantity: number }[] = [];
    for (const line of lines) {
      const parsed = parseWholeQuantity(qtys[line._id] ?? "", {
        allowZero: true,
        max: line.quantity,
        label: "Approved quantity",
      });
      if (!parsed.ok || parsed.value === undefined) {
        nextErrors[line._id] = parsed.ok ? "Enter approved quantity." : parsed.error;
        firstInvalidId ??= `appr-qty-${line._id}`;
      } else {
        lineInputs.push({ lineId: line._id, approvedQuantity: parsed.value });
      }
    }
    setLineErrors(nextErrors);
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (isStale) {
      setError("This request changed while open. Review the updated revision above before approving.");
      return;
    }
    setSaving(true);
    try {
      await approveMutation({
        requestId: request._id,
        expectedRevision: reviewedRevision,
        lines: lineInputs,
        operationKey: opKey,
      });
      onApproved();
    } catch (cause) {
      setError(parseStockError(cause, "Could not approve request.").message);
      setOpKey(createOperationKey("pr-approve"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Approve {request.reference}</SheetTitle>
          <SheetDescription>Confirm approved quantities for each requested item.</SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel="Approve request"
      >
        {isStale ? (
          <StockStaleBanner
            title="Request changed while reviewing"
            description={`This request moved from revision ${reviewedRevision} to ${request.revision}. Your entered quantities are preserved — review the latest request before approving.`}
            actionLabel="Review updated request"
            onReview={() => {
              setReviewedRevision(request.revision);
              setError("");
              setOpKey(createOperationKey("pr-approve"));
            }}
          />
        ) : null}
        <ul className="grid gap-3">
          {lines.map((line) => {
            const err = lineErrors[line._id];
            const inputId = `appr-qty-${line._id}`;
            return (
              <li key={line._id} className={cn("grid gap-2 rounded-lg border border-border p-3.5", err && "border-destructive/60")}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {line.item.productName} · {line.item.variantLabel}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">Requested: {line.quantity}</span>
                </div>
                <div className="grid gap-1 sm:max-w-xs">
                  <Label htmlFor={inputId}>Approved quantity (0–{line.quantity})</Label>
                  <NumberField
                    id={inputId}
                    value={qtys[line._id] ?? ""}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${inputId}-err` : undefined}
                    onChange={(event) => {
                      const val = event.target.value;
                      setQtys((curr) => ({ ...curr, [line._id]: val }));
                      setLineErrors((curr) => {
                        if (!curr[line._id]) return curr;
                        const next = { ...curr };
                        delete next[line._id];
                        return next;
                      });
                      setOpKey(createOperationKey("pr-approve"));
                    }}
                  />
                  <FieldError id={`${inputId}-err`}>{err}</FieldError>
                </div>
              </li>
            );
          })}
        </ul>
      </SheetForm>
    </EditorSheet>
  );
}

function RequestReasonActionSheet({
  action,
  reference,
  initialRevision,
  liveRevision,
  onClose,
  onConfirm,
}: {
  action: "send_back" | "decline" | "discard" | "close";
  reference: string;
  initialRevision: number;
  liveRevision: number;
  onClose: () => void;
  onConfirm: (reason: string, expectedRevision: number) => Promise<void>;
}) {
  const [reviewedRevision, setReviewedRevision] = useState(initialRevision);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { requestClose } = useStockDirtyGuard(reason.trim() !== "", onClose, saving);
  const isStale = liveRevision !== reviewedRevision;

  const copy = {
    send_back: { title: `Send ${reference} back for changes`, submit: "Send back", hint: "The requester can revise and resubmit it." },
    decline: { title: `Decline ${reference}`, submit: "Decline request", hint: "Declined requests cannot be reopened." },
    discard: { title: `Discard ${reference}`, submit: "Discard request", hint: "Hides this request and records the reason in History." },
    close: { title: `Close uncommitted demand on ${reference}`, submit: "Close demand", hint: "Prevents new orders from allocating remaining approved units. Linked orders stay intact." },
  }[action];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("A reason is required.");
      document.getElementById("pr-action-reason")?.focus();
      return;
    }
    if (isStale) {
      setError("This request changed while open. Review the updated revision above before confirming.");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(reason.trim(), reviewedRevision);
    } catch (cause) {
      setError(parseStockError(cause, "Action failed. Review the latest state and try again.").message);
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>{copy.title}</SheetTitle>
          <SheetDescription>{copy.hint}</SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel={copy.submit}
      >
        {isStale ? (
          <StockStaleBanner
            title="Request changed while open"
            description={`This request moved from revision ${reviewedRevision} to ${liveRevision}. Your reason is preserved — review the latest state before confirming.`}
            actionLabel="Review updated request"
            onReview={() => {
              setReviewedRevision(liveRevision);
              setError("");
            }}
          />
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="pr-action-reason">Reason</Label>
          <Input
            id="pr-action-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Enter reason…"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}
