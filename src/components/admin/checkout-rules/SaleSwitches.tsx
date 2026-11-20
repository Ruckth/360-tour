"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { Tone } from "@/components/admin/status-tones";
import { t } from "./checkout-rules-copy";
import { ReasonDialog } from "./ReasonDialog";
import { SALE_KINDS, SWITCH_STATES, salesUnlocked, switchRank, useRulesCommands, type RulesView, type SaleKind, type SwitchState } from "./use-checkout-rules";

const TONE: Record<SwitchState, Tone> = { off: "muted", managers: "info", everyone: "success" };
const HELP: Record<SwitchState, string> = { off: "switches.offHelp", managers: "switches.managersHelp", everyone: "switches.everyoneHelp" };

/**
 * The four sale switches (Off · Managers only · Everyone, all Off by default). Raising one needs new
 * payments on and every till reloaded; lowering is instant and is rollback step 1. Owner only.
 */
export function SaleSwitches({ view, onSaved }: { view: RulesView; onSaved: (message: string) => void }) {
  const { updateRules } = useRulesCommands();
  const [change, setChange] = useState<{ kind: SaleKind; to: SwitchState } | null>(null);
  const unlocked = salesUnlocked(view);
  const lockText = view.mode === "attempts" && view.tills.pending.length
    ? `${t("sell.raiseLocked")} ${t("sell.raiseLockedTills", { count: view.tills.pending.length })}`
    : t("sell.raiseLocked");
  const raising = change ? switchRank(change.to) > switchRank(view.switches[change.kind]) : false;

  return (
    <Card role="region" aria-labelledby="rules-sell-title" className="grid gap-4 p-5 lg:p-6" data-testid="sale-switches">
      <header>
        <h3 id="rules-sell-title" className="text-[15px] font-semibold">{t("admin.saleSwitches")}</h3>
        <p className="mt-1 text-pretty text-[13px] leading-5 text-muted-foreground">{t("sell.intro")}</p>
      </header>
      {view.canEdit && !unlocked ? (
        <p id="rules-sell-lock" className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-testid="sell-locked">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {lockText}
        </p>
      ) : null}
      <ul className="-mx-5 -mb-5 divide-y divide-border border-t border-border lg:-mx-6 lg:-mb-6">
        {SALE_KINDS.map((kind) => {
          const state = view.switches[kind];
          const label = t(`kinds.${kind}`);
          return (
            <li key={kind} className="grid gap-3 px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-center md:gap-6 lg:px-6" data-testid={`switch-${kind}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {label}
                  {view.canEdit ? null : <StatusBadge tone={TONE[state]} label={t(`switches.${state}`)} />}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t(HELP[state])}</p>
              </div>
              {view.canEdit ? (
                <ToggleGroup<SwitchState>
                  aria-label={label}
                  aria-describedby={!unlocked ? "rules-sell-lock" : undefined}
                  value={state}
                  onValueChange={(to) => setChange({ kind, to })}
                  className="w-full"
                >
                  {SWITCH_STATES.map((option) => (
                    <ToggleGroupItem key={option} value={option} disabled={!unlocked && switchRank(option) > switchRank(state)} className="min-h-11 flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-45">
                      {t(`switches.${option}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              ) : null}
            </li>
          );
        })}
      </ul>
      {change ? (
        <ReasonDialog
          title={t("sell.title", { kind: t(`kinds.${change.kind}`), state: t(`switches.${change.to}`) })}
          description={raising ? t("sell.raiseHint", { state: t(`switches.${change.to}`), help: t(HELP[change.to]) }) : t("sell.lowerHint")}
          chips={raising ? [t("sell.reasons.rehearsal"), t("sell.reasons.goLive")] : [t("sell.reasons.stop"), t("sell.reasons.problem")]}
          initialReason={raising ? "" : t("sell.reasons.stop")}
          confirmLabel={t("sell.confirm", { state: t(`switches.${change.to}`) })}
          signature={`switch:${change.kind}:${change.to}:${view.revision}`}
          onSubmit={({ reason, clientKey }) => updateRules({ expectedRevision: view.revision, clientKey, reason, switches: { [change.kind]: change.to } })}
          onDone={() => { setChange(null); onSaved(t("sell.saved", { kind: t(`kinds.${change.kind}`), state: t(`switches.${change.to}`) })); }}
          onClose={() => setChange(null)}
        />
      ) : null}
    </Card>
  );
}
