"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useReturnsDesk, type ExternalMethod, type OrderView, type ReturnClaim, type ReturnRecord } from "./backend";
import { resortTodayIso } from "convex/shared/time";
import { returnRefusal } from "./returnable-parts";
import { canCancel, freshInstruction, payoutStep, type FreshInstruction } from "./returns-desk";
import { voucherMasks } from "./checkout-ui";
import { ReplacementSlipList } from "./ReturnItemsEntry";
import { destinationText, methodName, payoutInstruction, returnRefusalText, returnsCopy } from "./returns-desk-copy";

const { t, money, date, when } = returnsCopy;

/** "2026-11-19T21:40" in Bangkok time, for a datetime-local field. */
const localInput = (at: number) => new Date(at + 7 * 3_600_000).toISOString().slice(0, 16);
const fromLocalInput = (value: string) => {
  const at = Date.parse(`${value}:00+07:00`);
  return Number.isSafeInteger(at) ? at : null;
};

/** The scrolling middle of the sheet. */
export function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-4", className)}>{children}</div>;
}
/** The pinned bottom of the sheet: the one next step stays above the keyboard. */
export function SheetActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-2 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3", className)}>{children}</div>;
}

const METHODS: ExternalMethod[] = ["cash", "card", "transfer", "promptpay"];
const STATE_KEYS = {
  owed: "returns.stateOwed", instructed: "returns.stateInstructed", given: "returns.stateGiven",
  failed: "returns.stateFailed", unknown: "returns.stateUnknown", cancelled: "returns.stateCancelled",
} as const;

/** A part of the return as staff know it: the row's name, or the content inside a package. */
function partLabel(view: OrderView, part: ReturnRecord["parts"][number]) {
  const line = view.lines.find((row) => row._id === part.lineId);
  const name = line?.saleSnapshot?.label ?? line?.name ?? "";
  if (part.kind === "cancelPackage") return t("returns.wholePackage", { name });
  if (part.kind === "content") return line?.saleSnapshot?.contents.find((content) => content.contentKey === part.contentKey)?.label ?? name;
  return name;
}

/**
 * The return after authorize: where the money goes and the one next step for its operator at this
 * till. A fresh "do it now" instruction shows only for the destination this screen just armed (or
 * the first authorize answer); any other instructed or unknown destination is Check previous refund,
 * which records what really happened and never invites a second payout.
 */
export function ReturnPayout({ view, record, tillId, fresh, onFresh, autoArm, codes, onBusyChange, onCompleted }: {
  view: OrderView;
  record: ReturnRecord;
  tillId: string;
  fresh: FreshInstruction | null;
  onFresh: (fresh: FreshInstruction | null) => void;
  /** The cashier watched their request get approved here: show the first instruction straight away. */
  autoArm: boolean;
  codes: Map<string, string>;
  onBusyChange: (busy: boolean) => void;
  onCompleted?: (message: string) => void;
}) {
  const id = useId();
  const now = useNow(30_000);
  const actions = useReturnsDesk()!.useActions();
  const manager = useStaffAccess().role !== "cashier";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<ExternalMethod | null>(null);
  const [stopped, setStopped] = useState(false);
  const [takeoverReason, setTakeoverReason] = useState("");
  // Reconciling an earlier day's instruction records when the money really went back (sol: next-day check).
  const [givenAt, setGivenAt] = useState("");
  const lock = useRef(false);
  const armed = useRef(false);
  const step = payoutStep(record, fresh);
  const control = { returnId: record.returnId, tillId, operatorRevision: record.operatorRevision };
  const here = record.isOperatorTill;

  async function run(name: string, action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    onBusyChange(true);
    setError("");
    try {
      await action();
    } catch (err) {
      const refusal = returnRefusal(err);
      setError(refusal ? returnRefusalText(refusal) : t("returns.couldNotSend"));
    } finally {
      lock.current = false;
      setBusy(null);
      onBusyChange(false);
    }
  }
  const arm = (claim: ReturnClaim) => run("arm", async () => {
    onFresh(freshInstruction(await actions.arm({ ...control, destinationKey: claim.key })));
  });
  const record_ = (claim: ReturnClaim, outcome: "given" | "failed" | "unknown", at?: number) => run(outcome, async () => {
    const clean = reference.trim();
    const next = await actions.recordPayout({
      ...control, destinationKey: claim.key, outcome,
      ...(outcome === "given" && clean ? { reference: clean } : {}), ...(outcome === "given" && at !== undefined ? { givenAt: at } : {}),
    });
    setReference("");
    setGivenAt("");
    onFresh(null);
    // The server's answer says whether this finished the return, not the claims shown before it.
    if (next.status === "completed") onCompleted?.(t("returns.completedNotice"));
  });
  const retry = (claim: ReturnClaim) => run("retry", async () => {
    await actions.retry({ ...control, destinationKey: claim.key, reason: t("returns.retryReason"), ...(method && method !== claim.method ? { method } : {}) });
    setMethod(null);
  });

  // Approved for this cashier at this till while they watched: arm the first destination once.
  const owedKey = step.kind === "owed" ? step.claim.key : null;
  useEffect(() => {
    if (!autoArm || !here || !owedKey || armed.current) return;
    const claim = record.claims.find((item) => item.key === owedKey);
    const timer = setTimeout(() => {
      if (armed.current || !claim) return;
      armed.current = true;
      void arm(claim);
    }, 0);
    return () => clearTimeout(timer);
    // Only the transition to an owed destination at this till arms; arm itself is stable for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoArm, here, owedKey]);

  const sending = busy !== null;
  const status = record.status === "completed" ? t("returns.completed") : record.status === "cancelled" ? t("returns.cancelled") : t("returns.inProgress");
  let actionsArea: ReactNode = null;
  let panel: ReactNode = null;

  if (record.status === "authorized" && !here) {
    const continueHere = record.isOperator && !record.claimed;
    panel = continueHere ? null : manager ? (
      <div className="grid gap-2 rounded-xl border border-border p-3">
        <p className="text-sm">{t("returns.heldElsewhere")}</p>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-foreground" checked={stopped} disabled={sending} onChange={(event) => setStopped(event.target.checked)} />
          {t("returns.takeOverStopped")}
        </label>
        <Label htmlFor={`${id}-takeover`} className="text-xs text-muted-foreground">{t("returns.reason")}</Label>
        <Input id={`${id}-takeover`} value={takeoverReason} maxLength={500} disabled={sending} placeholder={t("returns.takeOverReason")} onChange={(event) => setTakeoverReason(event.target.value)} />
      </div>
    ) : <p role="status" className="text-sm">{t("returns.heldElsewhere")}</p>;
    actionsArea = continueHere ? (
      <Button type="button" className="h-12" disabled={sending} onClick={() => void run("claim", () => actions.claim(control))}>{t("returns.continueHere")}</Button>
    ) : manager ? (
      <Button type="button" className="h-12" disabled={sending || !stopped || !takeoverReason.trim()}
        onClick={() => void run("claim", () => actions.claim({ ...control, previousOperatorStopped: true, reason: takeoverReason.trim() }))}>
        {busy === "claim" ? <Spinner label="Taking over" className="text-current" /> : null}
        {t("returns.takeOver")}
      </Button>
    ) : null;
  } else if (step.kind === "instruction") {
    const { claim } = step;
    panel = (
      <div className="grid gap-3 rounded-xl border-2 border-foreground p-3" data-return-instruction={claim.key}>
        <p className="text-lg font-semibold">{payoutInstruction(claim.method, claim.amount)}</p>
        <p className="text-xs text-muted-foreground" data-return-due="">{t("returns.refundDueBy", { date: date(claim.dueAt) })}</p>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-reference`} className="text-xs text-muted-foreground">{t("returns.reference")}</Label>
          <Input id={`${id}-reference`} value={reference} maxLength={128} disabled={sending} autoComplete="off" onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>
    );
    actionsArea = (
      <>
        <Button type="button" className="h-auto min-h-12 whitespace-normal text-[15px]" disabled={sending} onClick={() => void record_(claim, "given")} data-return-given="">
          {busy === "given" ? <Spinner label="Recording" className="text-current" /> : null}
          {t("buttons.moneyGivenBackRecord")}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-11" disabled={sending} onClick={() => void record_(claim, "failed")}>{t("returns.notGivenBack")}</Button>
          <Button type="button" variant="outline" className="h-11" disabled={sending} onClick={() => void record_(claim, "unknown")}>{t("returns.stateUnknown")}</Button>
        </div>
      </>
    );
  } else if (step.kind === "check") {
    const { claim } = step;
    // Sent on an earlier business day: the verified time dates the refund on the right day's report.
    const earlier = claim.instructedAt !== null && claim.instructedAt !== undefined && resortTodayIso(claim.instructedAt) !== resortTodayIso(now);
    const typed = earlier ? fromLocalInput(givenAt || localInput(claim.instructedAt!)) : undefined;
    // Minutes only on the field: never before the instruction itself, never in the future.
    const at = typed === undefined || typed === null ? typed : Math.min(now, Math.max(claim.instructedAt!, typed));
    panel = (
      <div className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-400/40 dark:bg-amber-400/10" data-return-check={claim.key}>
        <p className="text-base font-semibold">{t("returns.checkPreviousRefund")}</p>
        <p className="text-sm">{t("returns.checkPreviousBody", { method: methodName(claim.method), amount: money(claim.amount), time: claim.instructedAt ? when(claim.instructedAt) : "—" })}</p>
        <p className="text-xs text-muted-foreground" data-return-due="">{t("returns.refundDueBy", { date: date(claim.dueAt) })}</p>
        {earlier && here ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-given-at`} className="text-xs text-muted-foreground">{t("returns.givenAt")}</Label>
            <Input id={`${id}-given-at`} type="datetime-local" className="h-11" value={givenAt || localInput(claim.instructedAt!)} disabled={sending}
              min={localInput(claim.instructedAt!)} max={localInput(now)} onChange={(event) => setGivenAt(event.target.value)} />
          </div>
        ) : null}
      </div>
    );
    actionsArea = here ? (
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" className="h-auto min-h-12 whitespace-normal" disabled={sending || at === null} onClick={() => void record_(claim, "given", at ?? undefined)}>{t("returns.givenBack")}</Button>
        <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" disabled={sending} onClick={() => void record_(claim, "failed")}>{t("returns.wasNotGiven")}</Button>
      </div>
    ) : null;
  } else if (step.kind === "failed") {
    const { claim } = step;
    // Another method keeps the date the guest was promised (lead decision, PR 93 round 1).
    panel = (
      <div className="grid gap-2">
        {manager ? (
          <div role="group" aria-label={t("returns.otherMethod")} className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-4">
            {METHODS.map((value) => {
              const on = (method ?? claim.method) === value;
              return <Button key={value} type="button" variant={on ? "default" : "outline"} aria-pressed={on} className="h-11" disabled={sending} onClick={() => setMethod(value)}>{methodName(value)}</Button>;
            })}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground" data-return-due="">{t("returns.refundDueBy", { date: date(claim.dueAt) })}</p>
      </div>
    );
    actionsArea = (
      <Button type="button" className="h-12" disabled={sending} onClick={() => void retry(claim)}>
        {busy === "retry" ? <Spinner label="Retrying" className="text-current" /> : null}
        {method && method !== claim.method ? `${t("returns.retry")} · ${methodName(method)}` : t("returns.retry")}
      </Button>
    );
  } else if (step.kind === "owed") {
    const { claim } = step;
    actionsArea = (
      <Button type="button" className="h-auto min-h-12 whitespace-normal text-[15px]" disabled={sending} onClick={() => void arm(claim)} data-return-arm="">
        {busy === "arm" ? <Spinner label="Preparing" className="text-current" /> : null}
        {t("returns.refundTo", { amount: money(claim.amount), method: methodName(claim.method) })}
      </Button>
    );
    if (autoArm && busy === "arm") panel = <p role="status" className="text-sm font-semibold">{t("returns.approvedPayHere")}</p>;
  }

  const open = record.status === "authorized" && here;
  const masks = voucherMasks(view, codes);
  return (
    <>
      <SheetBody>
        <p role="status" data-return-status={record.status} className={cn("rounded-lg px-3 py-2 text-sm font-semibold",
          record.status === "completed" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : record.status === "cancelled" ? "bg-muted/60" : "bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200")}>
          {status}
        </p>
        <ul className="grid gap-1 text-sm" aria-label={t("returns.title")}>
          {record.parts.map((part, index) => <li key={index} className="[overflow-wrap:anywhere]">{partLabel(view, part)}</li>)}
        </ul>
        <section aria-label={t("returns.whereItGoes")} className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t("returns.whereItGoes")}</p>
          <ul className="grid gap-2 text-sm" data-return-claims="">
            {record.voucherCredits.flatMap((credit) => {
              const code = masks.get(credit.voucherId);
              // The money went (or goes) onto a new voucher, never back to the expired one; its slip is below.
              const replaced = credit.destination?.kind === "newVoucher" || record.giftSlips.some((slip) => slip.replaces === credit.voucherId);
              const paid = replaced ? destinationText({ kind: "voucher", voucherId: credit.voucherId, amount: credit.paid, code: code ?? null, goodwill: false, replacement: true })
                : code ? t("returns.toVoucher", { amount: money(credit.paid), code }) : t("returns.toVoucherUncoded", { amount: money(credit.paid) });
              return [
                credit.paid ? <li key={`${credit.voucherId}:paid`} data-return-credit={replaced ? "replacement" : "voucher"}>{paid}</li> : null,
                credit.goodwill ? <li key={`${credit.voucherId}:goodwill`}>{t("returns.goodwillToVoucher", { amount: money(credit.goodwill), code: code ?? "" })}</li> : null,
              ];
            })}
            {record.claims.map((claim) => (
              <li key={claim.key} data-claim-state={claim.state} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2">
                <span className="font-semibold">{destinationText({ kind: "external", method: claim.method, amount: claim.amount })}</span>
                <span className="text-xs text-muted-foreground">{t(STATE_KEYS[claim.state])}{claim.reference ? ` · ${claim.reference}` : ""}{claim.state !== "given" && claim.state !== "cancelled" ? ` · ${t("returns.refundDueBy", { date: date(claim.dueAt) })}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
        {record.giftSlips.length ? <ReplacementSlipList slips={record.giftSlips} view={view} codes={codes} /> : null}
        {panel}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </SheetBody>
      {actionsArea || (open && (canCancel(record) || step.kind !== "instruction")) ? (
        <SheetActions>
          {actionsArea}
          {open ? (
            <div className="flex flex-wrap justify-between gap-2">
              {step.kind !== "instruction" ? <Button type="button" variant="ghost" className="h-11" disabled={sending} onClick={() => void run("release", () => actions.release(control))}>{t("returns.release")}</Button> : <span />}
              {canCancel(record) ? (
                <Button type="button" variant="ghost" className="h-11 text-destructive hover:text-destructive" disabled={sending} onClick={() => void run("cancel", () => actions.cancel(control))}>
                  {busy === "cancel" ? <Spinner label="Cancelling" className="text-current" /> : null}
                  {t("returns.cancelReturn")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </SheetActions>
      ) : null}
    </>
  );
}
