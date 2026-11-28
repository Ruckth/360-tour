"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Id } from "convex/_generated/dataModel";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { newAttemptKey, useReturnsDesk, type ApprovalId, type OrderView, type ReturnLotOptions, type ReturnPreview, type ReturnRequestStatus, type ReturnRequestArgs } from "./backend";
import { cn } from "@/lib/utils";
import { CheckoutSheetContent } from "./CheckoutLayers";
import { DESK_TARGETS, voucherMasks } from "./checkout-ui";
import { ReturnLotChoice } from "./ReturnLotChoice";
import { ReturnPayout, SheetActions, SheetBody } from "./ReturnPayout";
import { returnableParts, returnRefusal, type DeskPart } from "./returnable-parts";
import {
  chosenParts, coveredByWhole, destinations, freshChoice, freshInstruction, initialChoices, missingCondition, quoteDueAt, rememberRequest, rememberedRequest,
  returnLotKey, returnsTillId, type Choice, type Choices, type Condition, type FreshInstruction,
} from "./returns-desk";
import { authorizeLabel, destinationText, returnRefusalText, returnsCopy } from "./returns-desk-copy";

/*
 * Return items (v27 "Returns: claim first, then one person pays out"). Staff tick what comes back,
 * say what condition goods came back in and why; the preview shows each amount and where it goes
 * before anything is recorded. A manager authorizes; a cashier asks a manager, who approves from
 * Approvals. Then one person at one till gives the money back, destination by destination.
 */

const { t, money, date } = returnsCopy;
const REASONS = ["packageCancelled", "changedMind", "faulty"] as const;

/** The sheet: what comes back, then the payout. Kept open while anything is being sent. */
export default function ReturnItemsSheet({ view, lineId, onClose, onCompleted }: { view: OrderView; lineId: Id<"orderLines"> | null; onClose: () => void; onCompleted?: (message: string) => void }) {
  const desk = useReturnsDesk()!;
  const access = useStaffAccess();
  // Returns follow the Team Refund rule (D14): managers authorize, and so does a cashier granted Refund.
  // A server that still wants a manager for this cashier turns the sheet back to Ask a manager.
  const [mustAsk, setMustAsk] = useState(false);
  const manager = (access.role !== "cashier" || access.cashierRules.refund === "cashier") && !mustAsk;
  const orderId = view.order._id;
  const [tillId] = useState(returnsTillId);
  const [returnId, setReturnId] = useState<Id<"orderReturns"> | null>(null);
  const [fresh, setFresh] = useState<FreshInstruction | null>(null);
  const [requestId, setRequestId] = useState<ApprovalId | null>(() => (manager ? null : rememberedRequest(orderId)));
  // This sheet watched the cashier's request until a manager approved it: arm the payout then.
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Map<string, string>>(() => new Map());
  const record = desk.useReturn({ orderId, returnId, tillId });
  // Follow this return by its id once seen, so it still shows when it completes or is cancelled.
  if (record && record.returnId !== returnId) setReturnId(record.returnId);
  const request = desk.useRequestStatus(requestId);
  const waiting = request?.status === "pending" && !record;
  useEffect(() => {
    if (requestId && request === null) rememberRequest(orderId, null);
    if (request && request.status !== "pending" && request.status !== "authorized") rememberRequest(orderId, null);
  }, [orderId, request, requestId]);
  // Seen waiting here: once a manager approves, this cashier's till arms the payout.
  if (waiting && !watched) setWatched(true);

  let body: ReactNode;
  if (record) {
    body = <ReturnPayout view={view} record={record} tillId={tillId} fresh={fresh} onFresh={setFresh} autoArm={watched} codes={codes} onBusyChange={setBusy} onCompleted={onCompleted} />;
  } else if (record === undefined || (requestId && request === undefined)) {
    body = <div className="grid flex-1 place-items-center p-6"><Spinner label="Loading" /></div>;
  } else if (waiting) {
    body = <WaitingForManager requestId={requestId!} view={view} summary={request.summary} onWithdrawn={() => { rememberRequest(orderId, null); setRequestId(null); }} onBusyChange={setBusy} />;
  } else if (view.activeReturn) {
    body = <SheetBody><p role="status" className="text-sm">{t("returns.heldElsewhere")}</p></SheetBody>;
  } else {
    body = (
      <ReturnPicker
        view={view} lineId={lineId} tillId={tillId} manager={manager} onBusyChange={setBusy}
        outcome={request && !["pending", "authorized", "cancelled"].includes(request.status) ? request.status : null}
        onPreview={(preview) => setCodes(new Map(preview.voucherCredits.flatMap((credit) => credit.maskedCode ? [[credit.voucherId, credit.maskedCode] as const] : [])))}
        onAuthorized={(result) => { setReturnId(result.returnId); setFresh(freshInstruction(result)); }}
        onAsked={(id) => { rememberRequest(orderId, id); setRequestId(id); setWatched(true); }}
        onManagerRequired={() => { if (access.role === "cashier") setMustAsk(true); }}
      />
    );
  }

  return (
    <Sheet open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <CheckoutSheetContent side="right" data-return-sheet="" className={cn(DESK_TARGETS, "flex h-full w-full max-w-full flex-col gap-0 bg-card p-0 sm:w-[30rem] sm:max-w-[calc(100vw-2rem)]")}>
        <div className="border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] pe-14">
          <SheetTitle>{t("returns.title")}</SheetTitle>
          <SheetDescription className="text-xs">{view.order.title}</SheetDescription>
        </div>
        {body}
      </CheckoutSheetContent>
    </Sheet>
  );
}

function WaitingForManager({ requestId, view, summary, onWithdrawn, onBusyChange }: { requestId: ApprovalId; view: OrderView; summary: ReturnRequestStatus["summary"]; onWithdrawn: () => void; onBusyChange: (busy: boolean) => void }) {
  const actions = useReturnsDesk()!.useActions();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const parts = summary ? returnableParts(view) : [];
  async function withdraw() {
    setSending(true);
    onBusyChange(true);
    setError("");
    try {
      await actions.decideApproval({ requestId, decision: "cancel" });
      onWithdrawn();
    } catch (err) {
      const refusal = returnRefusal(err);
      setError(refusal ? returnRefusalText(refusal) : t("returns.couldNotSend"));
    } finally {
      setSending(false);
      onBusyChange(false);
    }
  }
  return (
    <>
      <SheetBody>
        <p role="status" data-return-waiting="" className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">{t("returns.waiting")}</p>
        {summary ? <section aria-label="Requested return" className="grid gap-2 text-sm">
          <ul className="grid gap-1">{summary.parts.map((part, index) => <li key={index}>
            {parts.find(row => row.lineId === part.lineId && row.contentKey === part.contentKey)?.label ?? part.label ?? view.lines.find(line => line._id === part.lineId)?.name ?? "Item"} · {part.kind === "restoreSession" ? t("returns.restoreSession") : part.kind === "cancelPackage" ? t("returns.wholePackageShort") : `× ${part.units}`}
          </li>)}</ul>
          <h3 className="font-medium">{t("returns.whereItGoes")}</h3>
          {summary.payouts ? <ul className="grid gap-1">
            {summary.payouts.map((payout, index) => <li key={index} className="capitalize">{payout.label}{payout.destinationMask ? ` · ${payout.destinationMask}` : ""} · {money(payout.amount)}</li>)}
            {!summary.payouts.length ? <li>{t("returns.noPayout")}</li> : null}
          </ul> : <p className="text-muted-foreground">Payout details are unavailable for this request.</p>}
        </section> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </SheetBody>
      <SheetActions>
        <Button type="button" variant="outline" className="h-12" disabled={sending} onClick={() => void withdraw()}>
          {sending ? <Spinner label="Withdrawing" className="text-current" /> : null}
          {t("returns.withdrawRequest")}
        </Button>
      </SheetActions>
    </>
  );
}

type Sent = { args: ReturnRequestArgs; ask: boolean };

function ReturnPicker({ view, lineId, tillId, manager, outcome, onPreview, onAuthorized, onAsked, onManagerRequired, onBusyChange }: {
  view: OrderView;
  lineId: Id<"orderLines"> | null;
  tillId: string;
  manager: boolean;
  /** A cashier's earlier request that didn't go through. */
  outcome: string | null;
  onPreview: (preview: ReturnPreview) => void;
  onAuthorized: (result: Parameters<typeof freshInstruction>[0] & { returnId: Id<"orderReturns"> }) => void;
  onAsked: (requestId: ApprovalId) => void;
  onManagerRequired: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const desk = useReturnsDesk()!;
  const actions = desk.useActions();
  const parts = useMemo(() => returnableParts(view), [view]);
  const [choices, setChoices] = useState<Choices>(() => initialChoices(parts, lineId));
  const [mistaken, setMistaken] = useState(false);
  const [reason, setReason] = useState("");
  const [key] = useState(newAttemptKey);
  const [preview, setPreview] = useState<{ key: string; value: ReturnPreview } | null>(null);
  const [refused, setRefused] = useState<{ key: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // After a lost answer the retry sends exactly the same request with the same key.
  const sent = useRef<Sent | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);

  const sellable = parts.filter(part => part.kind === "goods" && choices[part.partKey]?.condition === "sellable");
  const lotResult = desk.useLots(sellable.length ? { orderId: view.order._id, parts: sellable.map(({ lineId, contentKey }) => ({
    lineId, ...(contentKey === null ? {} : { contentKey }),
  })) } : null);
  const lotOptions = useMemo(() => Array.isArray(lotResult) ? new Map(lotResult.map(option => [returnLotKey(option), option])) : null, [lotResult]);
  const chosen = useMemo(() => chosenParts(parts, choices, lotOptions), [parts, choices, lotOptions]);
  const voucherSale = parts.some((part) => part.voucherSale && choices[part.partKey]);
  const base = useMemo(() => chosen?.length ? {
    orderId: view.order._id, expectedRevision: view.order.revision, expectedCorrectionRevision: view.paymentRecord.correctionRevision,
    clientKey: key, tillId, parts: chosen, ...(voucherSale && mistaken ? { mistakenSale: true } : {}),
  } : null, [chosen, key, mistaken, tillId, view.order._id, view.order.revision, view.paymentRecord.correctionRevision, voucherSale]);
  const previewKey = base ? JSON.stringify(base) : "";
  useEffect(() => {
    if (!base) return;
    let live = true;
    const timer = setTimeout(() => {
      actions.preview({ ...base, reason: "Return items" }).then(
        (value) => { if (live) { setPreview({ key: previewKey, value }); setRefused(null); onPreview(value); } },
        (err) => { if (live) { const refusal = returnRefusal(err); setPreview(null); setRefused({ key: previewKey, text: refusal ? returnRefusalText(refusal) : t("returns.couldNotSend") }); } },
      );
    }, 120);
    return () => { live = false; clearTimeout(timer); };
    // previewKey stands for base; onPreview and actions are stable for this sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const current = preview?.key === previewKey ? preview.value : null;
  // The server's refusal of exactly this choice (another choice checks again).
  const previewError = refused?.key === previewKey ? refused.text : "";
  const missing = missingCondition(parts, choices);
  const ready = Boolean(base && current && reason.trim()) && !sending;

  function choose(part: DeskPart, next: Choice | null) {
    setChoices((all) => {
      const copy = { ...all };
      if (next) copy[part.partKey] = next;
      else delete copy[part.partKey];
      return copy;
    });
  }

  async function submit() {
    if (lock.current || (!ready && !uncertain)) return;
    const request = sent.current ?? (base ? { args: { ...base, reason: reason.trim() }, ask: !manager } : null);
    if (!request) return;
    lock.current = true;
    sent.current = request;
    const { args, ask } = request;
    setSending(true);
    onBusyChange(true);
    setError("");
    try {
      if (ask) {
        const result = await actions.askManager(args);
        onAsked(result.requestId);
      } else {
        onAuthorized(await actions.authorize(args));
      }
    } catch (err) {
      const refusal = returnRefusal(err);
      if (refusal) {
        sent.current = null;
        setUncertain(false);
        if (refusal.code === "RETURN_APPROVAL_PENDING" && refusal.requestId && ask) onAsked(refusal.requestId);
        if (refusal.code === "RETURN_MANAGER_REQUIRED" && !ask) onManagerRequired();
        setError(returnRefusalText(refusal));
      } else {
        setUncertain(true);
        setError(t("returns.couldNotSend"));
      }
    } finally {
      lock.current = false;
      setSending(false);
      onBusyChange(false);
    }
  }

  const frozen = sending || uncertain;
  const rows = groupRows(parts);
  const label = uncertain ? t("returns.retrySame") : !base ? t("returns.pickParts") : missing ? t("returns.chooseCondition", { name: missing.label })
    : !reason.trim() ? t("returns.pickReason") : !manager ? t("buttons.askManager")
    // A refused choice says so above; the button asks for another choice, not "Checking amounts".
    : previewError ? t("returns.pickParts") : !current ? t("returns.checking") : authorizeLabel(destinations(current, voucherMasks(view)));

  return (
    <>
      <SheetBody>
        {outcome ? <p role="status" className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{t(outcome === "rejected" ? "returns.requestDeclined" : outcome === "expired" ? "returns.requestExpired" : "returns.requestStale")}</p> : null}
        {parts.length ? (
          <ul className="grid gap-3" aria-label={t("returns.title")}>
            {rows.map(({ lineId: row, name, items }) => (
              <li key={row} className="grid gap-2 rounded-xl border border-border bg-background p-3">
                <p className="text-sm font-semibold text-pretty [overflow-wrap:anywhere]">{name}</p>
                {items.filter((part) => !coveredByWhole(part, choices)).map((part) => (
                  <PartChoice key={part.partKey} part={part} choice={choices[part.partKey] ?? null} disabled={frozen} lots={lotOptions?.get(part.partKey)} onChange={(next) => choose(part, next)} />
                ))}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("returns.nothingToReturn")}</p>}
        {sellable.length && lotResult instanceof Error ? (
          <p role="alert" className="text-sm text-destructive">{t("returns.lotsUnavailable")}</p>
        ) : null}
        {sellable.length && lotResult === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">{t("returns.loadingLots")}</p>
        ) : null}
        {voucherSale ? (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-foreground" checked={mistaken} disabled={frozen} onChange={(event) => setMistaken(event.target.checked)} />
            {t("returns.soldByMistake")}
          </label>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor={`${id}-reason`} className="text-xs text-muted-foreground">{t("returns.reason")}</Label>
          <div role="group" aria-label={t("returns.reason")} className="flex flex-wrap gap-2">
            {REASONS.map((value) => {
              const text = t(`returns.reasons.${value}`);
              return (
                <Button key={value} type="button" size="sm" variant={reason === text ? "default" : "outline"} aria-pressed={reason === text} disabled={frozen}
                  className="h-11 rounded-full px-4" onClick={() => setReason(reason === text ? "" : text)}>{text}</Button>
              );
            })}
          </div>
          <Input id={`${id}-reason`} placeholder={t("returns.reasonPlaceholder")} value={reason} maxLength={500} disabled={frozen} autoComplete="off" onChange={(event) => setReason(event.target.value)} />
        </div>
        <ReturnQuote view={view} preview={current} error={previewError} loading={Boolean(base) && !current && !previewError} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </SheetBody>
      <SheetActions>
        <Button type="button" className="h-auto min-h-12 w-full whitespace-normal text-[15px]" disabled={uncertain ? sending : !ready} onClick={() => void submit()} data-return-submit="">
          {sending ? <Spinner label={manager ? "Authorizing" : "Sending"} className="text-current" /> : null}
          {label}
        </Button>
      </SheetActions>
    </>
  );
}

function groupRows(parts: DeskPart[]) {
  const rows: { lineId: string; name: string; items: DeskPart[] }[] = [];
  for (const part of parts) {
    const row = rows.find((item) => item.lineId === part.lineId);
    if (row) row.items.push(part);
    else rows.push({ lineId: part.lineId, name: part.rowName, items: [part] });
  }
  return rows;
}

const CONDITIONS: { value: Condition; key: string }[] = [
  { value: "sellable", key: "returns.sellable" },
  { value: "damaged", key: "returns.damaged" },
  { value: "guest", key: "returns.staysWithGuest" },
];

/** One returnable part: a tick, its units, and for goods what came back. */
function PartChoice({ part, choice, disabled, lots, onChange }: {
  part: DeskPart; choice: Choice | null; disabled: boolean; lots?: ReturnLotOptions; onChange: (next: Choice | null) => void;
}) {
  // The row's card already names the package.
  const label = part.kind === "whole" ? t("returns.wholePackageShort") : part.kind === "restore" ? t("returns.restoreSession") : part.label;
  const units = choice && part.maxUnits > 1 ? (
    <div role="group" aria-label={t("returns.units", { name: part.label })} className="flex items-center gap-1">
      <Button type="button" size="icon" variant="outline" className="size-11" aria-label={t("returns.fewer")} disabled={disabled || choice.units <= 1} onClick={() => onChange({ ...choice, units: choice.units - 1 })}><Minus aria-hidden className="size-4" /></Button>
      <Input type="number" inputMode="numeric" min={1} max={part.maxUnits} step={1}
        aria-label={t("returns.units", { name: part.label })}
        aria-invalid={!Number.isSafeInteger(choice.units) || choice.units < 1 || choice.units > part.maxUnits}
        className="h-11 w-20 text-center font-sans tabular-nums" value={choice.units || ""} disabled={disabled}
        onChange={(event) => onChange({ ...choice, units: Number(event.target.value) })} />
      <Button type="button" size="icon" variant="outline" className="size-11" aria-label={t("returns.more")} disabled={disabled || choice.units >= part.maxUnits} onClick={() => onChange({ ...choice, units: choice.units + 1 })}><Plus aria-hidden className="size-4" /></Button>
    </div>
  ) : null;
  if (part.kind === "goods") {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-pretty [overflow-wrap:anywhere]">{label}</p>
          {units}
        </div>
        <div role="group" aria-label={t("returns.conditionOf", { name: part.label })} className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-3">
          {CONDITIONS.filter(({ value }) => !(part.custody && value === "guest")).map(({ value, key }) => {
            const on = choice?.condition === value;
            return (
              <Button key={value} type="button" variant={on ? "default" : "outline"} aria-pressed={on} disabled={disabled}
                className="h-auto min-h-11 whitespace-normal px-2 text-[13px] leading-tight"
                onClick={() => onChange(on ? null : { units: choice?.units ?? part.maxUnits, condition: value })}>
                {t(key)}
              </Button>
            );
          })}
        </div>
        {choice?.condition === "sellable" && lots?.unavailable ? (
          <p role="alert" className="text-sm text-destructive">{t("returns.lotsUnavailable")}</p>
        ) : null}
        {choice?.condition === "sellable" && lots?.tracked ? <ReturnLotChoice options={lots.lots} choice={choice} disabled={disabled} onChange={onChange} /> : null}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5 shrink-0 accent-foreground" checked={Boolean(choice)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? freshChoice(part) : null)} />
        <span className="min-w-0 text-pretty [overflow-wrap:anywhere]">{label}</span>
      </label>
      {units}
    </div>
  );
}

/** Each part's amount, the return total and where every baht goes, before anything is recorded. */
function ReturnQuote({ view, preview, error, loading }: { view: OrderView; preview: ReturnPreview | null; error: string; loading: boolean }) {
  if (error) return <p role="alert" data-return-quote-error="" className="rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!preview) return loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner label={t("returns.checking")} /> {t("returns.checking")}</p> : null;
  const list = destinations(preview, voucherMasks(view));
  const money_ = list.filter((item) => item.kind !== "restore");
  const due = quoteDueAt(view, preview);
  return (
    <section aria-label={t("returns.whereItGoes")} data-return-quote="" className="grid gap-2 rounded-xl bg-muted/50 p-3 text-sm">
      <ul className="grid gap-1">
        {preview.rows.map((row) => (
          <li key={row.lineId} className="grid gap-0.5">
            <span className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span><span className="font-sans tabular-nums">{money(row.amount)}</span></span>
            {/* A package's parts, or a session put back on a visit (no money), each on its own line. */}
            {row.parts.length > 1 || row.parts.some((part) => part.kind === "restore") ? (
              <ul className="grid gap-0.5 pl-3 text-xs text-muted-foreground" data-return-parts="">
                {row.parts.map((part, index) => (
                  <li key={`${part.contentKey ?? part.kind}:${index}`} className="flex justify-between gap-3">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{part.kind === "restore" ? t("returns.restoreSession") : part.label}</span>
                    <span className="font-sans tabular-nums">{money(part.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {preview.rows.length > 1 || money_.length > 1 ? (
        <p className="flex justify-between gap-3 border-t border-border pt-2 font-semibold" data-return-total="">
          <span>{t("returns.returnTotal")}</span><span className="font-sans tabular-nums">{money(preview.amount)}</span>
        </p>
      ) : null}
      <p className="border-t border-border pt-2 text-xs font-medium text-muted-foreground">{t("returns.whereItGoes")}</p>
      <ul className="grid gap-1" data-return-destinations="">
        {list.map((item, index) => (
          <li key={index} className={item.kind === "external" ? "font-semibold" : undefined}>{destinationText(item)}</li>
        ))}
        {!money_.length ? <li>{t("returns.noPayout")}</li> : null}
      </ul>
      {due ? <p className="text-xs text-muted-foreground" data-return-due="">{t("returns.refundDueBy", { date: date(due) })}</p> : null}
    </section>
  );
}
