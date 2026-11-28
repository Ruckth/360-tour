"use client";

import { CircleCheck, CircleDashed, ExternalLink } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { cn } from "@/lib/utils";
import { reconciliationOutcomes, refusal, refusalText, t, when } from "./checkout-rules-copy";
import { ReasonDialog } from "./ReasonDialog";
import { useRulesCommands, type DirectPanelRow, type RulesView } from "./use-checkout-rules";

type Open = "pause" | "resume" | "activate" | null;
type StillOpen = {
  panels: { tillKey: string; orderId: string; openedAt: number; panelKey: string }[];
  attempts: { attemptId: string; orderId: string; tillId: string; status: string; openedAt: number }[];
  moreAttempts: boolean;
};

const tillName = (key: string) => (key === "default" ? t("payments.mainTill") : key);
const METHOD_KEY = { cash: "pay.cash", promptpay: "pay.promptPay", card: "pay.card", transfer: "pay.transfer" } as const;
const ATTEMPT_STATUS: Record<string, string> = {
  collecting: "payments.attemptCollecting", refused: "payments.attemptRefused", recovering: "payments.attemptRecovering",
};

function instructionSummary(panel: DirectPanelRow) {
  const tenders = panel.instruction?.tenders;
  if (!tenders?.length) return t("payments.panelNoInstruction");
  return tenders.map((tender) => `${t(METHOD_KEY[tender.method])} ${formatMoney(tender.amount)}`).join(" + ");
}

/**
 * The registration a manager reviewed on this row: a replacement under the same key, or any change
 * on the till (instruction, check, takeover), clears the confirmation.
 */
const reviewKey = (panel: DirectPanelRow) => `${panel.tillId}:${panel.panelKey}:${panel.instanceId}:${panel.revision}`;
/** What the server checks the manager reviewed (the row's registration and revision) and confirmed (its till stopped). */
const reviewed = (panel: DirectPanelRow) => ({
  tillId: panel.tillId, panelKey: panel.panelKey, expectedInstanceId: panel.instanceId, expectedRevision: panel.revision,
  stoppedPreviousOperator: true,
});

/**
 * Manager direct-panel reconciliation during the cutover (recorded, nothing taken, or collected
 * without receipt), each only after confirming that till's cashier has stopped.
 */
function OpenDirectPanels({ panels, onSaved }: { panels: DirectPanelRow[]; onSaved: (message: string) => void }) {
  const commands = useRulesCommands();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [unrecorded, setUnrecorded] = useState<DirectPanelRow | null>(null);
  const [stopped, setStopped] = useState<ReadonlySet<string>>(() => new Set());
  if (!panels.length) return null;

  function confirmStopped(panel: DirectPanelRow, checked: boolean) {
    setStopped((current) => {
      const next = new Set(current);
      if (checked) next.add(reviewKey(panel)); else next.delete(reviewKey(panel));
      return next;
    });
  }

  async function reconcile(panel: DirectPanelRow, outcome: "recorded" | "nothing_taken") {
    const key = `${panel.tillId}:${panel.panelKey}:${outcome}`;
    setBusyKey(key);
    setError("");
    try {
      await commands.reconcileDirectPanel({ ...reviewed(panel), outcome });
      onSaved(t("payments.reconcileDone"));
    } catch (err) {
      setError(refusalText(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="grid gap-2" data-testid="direct-panels-reconcile">
      <div className="grid gap-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("payments.openPanelsTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("payments.openPanelsHint")}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-lg border border-border">
        {panels.map((panel) => {
          const staff = panel.actorEmail ? panel.actorEmail.split("@")[0] : panel.actor;
          const confirmed = stopped.has(reviewKey(panel));
          const idle = busyKey === null && confirmed;
          const checkbox = `stopped-${panel.tillId}-${panel.panelKey}`;
          return (
            <li key={`${panel.tillId}:${panel.panelKey}`} data-testid="direct-panel-row" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid min-w-0 gap-0.5 wrap-anywhere">
                  <p className="font-medium">{t("payments.panelCashier", { till: tillName(panel.tillKey), staff, time: when(panel.openedAt) })}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {instructionSummary(panel)}
                    {panel.receiptNumber !== null ? ` · ${t("payments.panelReceipt", { order: String(panel.receiptNumber) })}` : ""}
                  </p>
                  {panel.stale ? <p className="text-xs text-amber-800 dark:text-amber-300">{t("payments.panelStale")}</p> : null}
                  {panel.receiptUsed ? <p className="text-xs text-amber-800 dark:text-amber-300">{t("payments.panelReceiptUsed")}</p> : null}
                </div>
                <a href={`/admin/checkout?order=${panel.orderId}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium underline underline-offset-4">
                  {t("payments.openOrder")}<ExternalLink aria-hidden className="size-3.5" />
                </a>
              </div>
              <label htmlFor={checkbox} className="flex min-h-11 min-w-0 items-center gap-3">
                <input id={checkbox} type="checkbox" className="size-5 shrink-0" checked={confirmed} onChange={(event) => confirmStopped(panel, event.target.checked)} />
                <span className="min-w-0 wrap-anywhere">{t("pay.operatorStopped", { staff })}</span>
              </label>
              <details open className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {reconciliationOutcomes.title}
                </summary>
                <dl className="mt-2 grid gap-1.5 text-muted-foreground sm:grid-cols-3">
                  <div className="grid gap-0.5">
                    <dt className="font-semibold text-foreground">{t("payments.reconcileRecorded")}</dt>
                    <dd>
                      {panel.canRecord
                        ? reconciliationOutcomes.recorded
                        : reconciliationOutcomes.recordedUnavailable}
                    </dd>
                  </div>
                  <div className="grid gap-0.5">
                    <dt className="font-semibold text-foreground">{t("payments.reconcileNothingTaken")}</dt>
                    <dd>{reconciliationOutcomes.nothingTaken}</dd>
                  </div>
                  <div className="grid gap-0.5">
                    <dt className="font-semibold text-foreground">{t("payments.reconcileUnrecorded")}</dt>
                    <dd>{reconciliationOutcomes.unrecorded}</dd>
                  </div>
                </dl>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="h-11" disabled={!panel.canRecord || !idle} onClick={() => void reconcile(panel, "recorded")}>
                  {t("payments.reconcileRecorded")}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-11" disabled={!idle} onClick={() => void reconcile(panel, "nothing_taken")}>
                  {t("payments.reconcileNothingTaken")}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-11" disabled={!idle} onClick={() => setUnrecorded(panel)}>
                  {t("payments.reconcileUnrecorded")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {unrecorded ? (
        <ReasonDialog
          title={t("payments.reconcileUnrecordedTitle")}
          description={t("payments.reconcileUnrecordedHint")}
          chips={[]}
          confirmLabel={t("payments.reconcileUnrecorded")}
          signature={`reconcile:${reviewKey(unrecorded)}`}
          onSubmit={({ reason }) => commands.reconcileDirectPanel({ ...reviewed(unrecorded), outcome: "collected_unrecorded", note: reason })}
          onDone={() => { setUnrecorded(null); onSaved(t("payments.reconcileDone")); }}
          onClose={() => setUnrecorded(null)}
        />
      ) : null}
    </div>
  );
}

/** What is still open when Switch to new payments is refused, each with a way to it. */
function StillOpenList({ open, tills }: { open: StillOpen; tills: RulesView["tills"] }) {
  const tillKey = (tillId: string) => [...tills.acknowledged, ...tills.pending].find((till) => till.tillId === tillId)?.key ?? "default";
  const rows = [
    ...open.panels.map((panel) => ({ id: `panel:${panel.panelKey}`, orderId: panel.orderId, text: t("payments.panelRow", { till: tillName(panel.tillKey), time: when(panel.openedAt) }) })),
    ...open.attempts.map((attempt) => ({
      id: `attempt:${attempt.attemptId}`, orderId: attempt.orderId,
      text: t("payments.attemptRow", { status: t(ATTEMPT_STATUS[attempt.status] ?? "payments.attemptCollecting"), till: tillName(tillKey(attempt.tillId)), time: when(attempt.openedAt) }),
    })),
  ];
  return (
    <div className="grid gap-2 text-foreground" data-testid="still-open">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("payments.stillOpenTitle")}</p>
      <ul className="grid divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 basis-48">{row.text}</span>
            <a href={`/admin/checkout?order=${row.orderId}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("payments.openOrder")}<ExternalLink aria-hidden className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
      {open.moreAttempts ? <p className="text-xs text-muted-foreground">{t("payments.moreAttempts")}</p> : null}
    </div>
  );
}

function Tills({ tills, onSaved }: { tills: RulesView["tills"]; onSaved: (message: string) => void }) {
  const commands = useRulesCommands();
  const [retiring, setRetiring] = useState<{ tillId: RulesView["tills"]["pending"][number]["tillId"]; key: string } | null>(null);
  const rows = [
    ...tills.acknowledged.map((till) => ({ id: till.tillId, key: till.key, at: till.at as number | null })),
    ...tills.pending.map((till) => ({ id: till.tillId, key: till.key, at: null })),
  ];
  if (!rows.length) return <p className="text-sm text-muted-foreground" data-testid="tills-none">{t("payments.noTills")}</p>;
  return (
    <div className="grid gap-2">
      <ul aria-label={t("payments.tillsTitle")} className="grid divide-y divide-border rounded-lg border border-border" data-testid="tills">
        {rows.map((till) => (
          <li key={till.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            {till.at ? <CircleCheck aria-hidden className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" /> : <CircleDashed aria-hidden className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />}
            <span className="min-w-0 flex-1 font-medium">{tillName(till.key)}</span>
            <span className="text-muted-foreground">{till.at ? t("payments.tillReady", { time: when(till.at) }) : t("payments.tillPending")}</span>
            {!till.at && till.key !== "default" ? (
              <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setRetiring({ tillId: till.id, key: till.key })}>
                {t("payments.retireTill")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {!tills.pending.length ? <p className="text-sm text-muted-foreground">{t("payments.allReady")}</p> : null}
      {retiring ? (
        <ReasonDialog
          title={t("payments.retireTillTitle", { till: tillName(retiring.key) })}
          description={t("payments.retireTillHint")}
          chips={[t("payments.retireTillReason")]}
          initialReason={t("payments.retireTillReason")}
          confirmLabel={t("payments.retireTill")}
          signature={`retire:${retiring.tillId}`}
          onSubmit={({ reason }) => commands.retireTill({ tillId: retiring.tillId, reason })}
          onDone={() => { setRetiring(null); onSaved(t("payments.tillRetired")); }}
          onClose={() => setRetiring(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The payments cutover (v27 Rollout; ship plan "Cutover, after PR 3 deploys"): pause checkout,
 * finish open pay panels, Switch to new payments (one way), then every till reloads. Owners and
 * managers run it; the server checks the same.
 */
export function PaymentsCutover({ view, onSaved }: { view: RulesView; onSaved: (message: string) => void }) {
  const commands = useRulesCommands();
  const [open, setOpen] = useState<Open>(null);
  const on = view.mode === "attempts";
  const status = on
    ? { tone: "success" as const, label: t("payments.statusOn") }
    : view.paused ? { tone: "warning" as const, label: t("payments.statusPaused") } : { tone: "muted" as const, label: t("payments.statusOff") };
  const step = on ? 4 : view.paused ? 2 : 1;
  const steps = ["payments.step1", "payments.step2", "payments.step3", "payments.step4"];
  const edit = { expectedRevision: view.revision };

  return (
    <Card role="region" aria-labelledby="rules-payments-title" className="grid gap-4 p-5 lg:p-6" data-testid="payments-cutover">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h3 id="rules-payments-title" className="text-[15px] font-semibold">{t("payments.title")}</h3>
          <p className="mt-1 text-pretty text-[13px] leading-5 text-muted-foreground">
            {on && view.cutoverAt ? t("payments.onSince", { date: when(view.cutoverAt) }) : t("payments.intro")}
          </p>
        </div>
        <StatusBadge {...status} data-testid="payments-status" />
      </header>

      {!on ? (
        <ol className="grid gap-2 text-sm">
          {steps.map((key, index) => (
            <li key={key} className={cn("flex gap-3", index + 1 < step ? "text-muted-foreground" : index + 1 === step ? "font-medium text-foreground" : "text-muted-foreground")} aria-current={index + 1 === step ? "step" : undefined}>
              <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular-nums", index + 1 < step ? "border-transparent bg-muted" : index + 1 === step ? "border-foreground" : "border-border")}>
                {index + 1 < step ? "✓" : index + 1}
              </span>
              <span className="pt-0.5">{t(key)}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {on ? <Tills tills={view.tills} onSaved={onSaved} /> : (
        <>
          <OpenDirectPanels panels={view.directPanels} onSaved={onSaved} />
          <div className="flex flex-wrap gap-2">
            {view.paused ? (
              <>
                <Button type="button" className="h-11" onClick={() => setOpen("activate")}>{t("cutover.activate")}</Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setOpen("resume")}>{t("cutover.resume")}</Button>
              </>
            ) : (
              <Button type="button" variant="outline" className="h-11" onClick={() => setOpen("pause")}>{t("cutover.pause")}</Button>
            )}
          </div>
        </>
      )}

      {open === "pause" || open === "resume" ? (
        <ReasonDialog
          title={t(open === "pause" ? "payments.pauseTitle" : "payments.resumeTitle")}
          description={t(open === "pause" ? "payments.pauseHint" : "payments.resumeHint")}
          chips={[t("payments.pauseReason"), t("sell.reasons.problem")]}
          initialReason={t("payments.pauseReason")}
          confirmLabel={t(open === "pause" ? "cutover.pause" : "cutover.resume")}
          signature={`paused:${open === "pause"}:${view.revision}`}
          onSubmit={({ reason, clientKey }) => commands.setPaused({ ...edit, clientKey, reason, paused: open === "pause" })}
          onDone={() => { setOpen(null); onSaved(t(open === "pause" ? "payments.paused" : "payments.resumed")); }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "activate" ? (
        <ReasonDialog
          title={t("payments.activateTitle")}
          description={t("payments.activateHint")}
          chips={[t("payments.activateReason")]}
          initialReason={t("payments.activateReason")}
          confirmLabel={t("cutover.activate")}
          signature={`activate:${view.revision}`}
          onSubmit={({ reason, clientKey }) => commands.activate({ ...edit, clientKey, reason })}
          onDone={() => { setOpen(null); onSaved(t("payments.switched")); }}
          onClose={() => setOpen(null)}
          problem={(err) => {
            const data = refusal(err);
            return data?.code === "PAYMENTS_STILL_OPEN" ? <StillOpenList open={data as unknown as StillOpen} tills={view.tills} /> : null;
          }}
        />
      ) : null}
    </Card>
  );
}
