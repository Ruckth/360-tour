"use client";

import { CircleCheck, CircleDashed, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { cn } from "@/lib/utils";
import { refusal, t, when } from "./checkout-rules-copy";
import { ReasonDialog } from "./ReasonDialog";
import { useRulesCommands, type RulesView } from "./use-checkout-rules";

type Open = "pause" | "resume" | "activate" | null;
type StillOpen = {
  panels: { tillKey: string; orderId: string; openedAt: number; panelKey: string }[];
  attempts: { attemptId: string; orderId: string; tillId: string; status: string; openedAt: number }[];
  moreAttempts: boolean;
};

const tillName = (key: string) => (key === "default" ? t("payments.mainTill") : key);
const ATTEMPT_STATUS: Record<string, string> = {
  collecting: "payments.attemptCollecting", refused: "payments.attemptRefused", recovering: "payments.attemptRecovering",
};

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

function Tills({ tills }: { tills: RulesView["tills"] }) {
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
          </li>
        ))}
      </ul>
      {!tills.pending.length ? <p className="text-sm text-muted-foreground">{t("payments.allReady")}</p> : null}
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

      {on ? <Tills tills={view.tills} /> : (
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
