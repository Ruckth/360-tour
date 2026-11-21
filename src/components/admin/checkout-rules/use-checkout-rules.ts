"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useRef } from "react";

export type Terms = FunctionReturnType<typeof api.commerce.settings.getRules>["terms"];
export type Switches = FunctionReturnType<typeof api.commerce.settings.getRules>["switches"];
export type SaleKind = keyof Switches;
export type SwitchState = Switches[SaleKind];
type Status = FunctionReturnType<typeof api.commerce.paymentCutover.status>;
export type DirectPanelRow = FunctionReturnType<typeof api.commerce.paymentCutover.directPanels>[number];

export const SALE_KINDS = ["products", "vouchers", "sessionPackages", "mixedPackages"] as const satisfies readonly SaleKind[];
export const SWITCH_STATES = ["off", "managers", "everyone"] as const satisfies readonly SwitchState[];
export const switchRank = (state: SwitchState) => SWITCH_STATES.indexOf(state);

/**
 * Everything the page shows. Owners and managers read the rules and the cutover status; only the
 * owner (canEdit) changes the rules and switches, and the server refuses anyone else.
 */
export type RulesView = {
  revision: number;
  terms: Terms;
  switches: Switches;
  mode: "direct" | "attempts";
  paused: boolean;
  cutoverAt: number | null;
  tills: Pick<Status, "acknowledged" | "pending">;
  directPanels: DirectPanelRow[];
  canEdit: boolean;
  /** Opens the page's History; null until the first change. */
  settingsId: FunctionReturnType<typeof api.commerce.settings.getRules>["settingsId"];
};

export function useCheckoutRules(enabled: boolean): RulesView | undefined {
  const rules = useQuery(api.commerce.settings.getRules, enabled ? {} : "skip");
  const status = useQuery(api.commerce.paymentCutover.status, enabled ? {} : "skip");
  const panels = useQuery(api.commerce.paymentCutover.directPanels, enabled && status?.mode === "direct" ? {} : "skip");
  if (!rules || !status) return undefined;
  return {
    revision: rules.revision, terms: rules.terms, switches: rules.switches, mode: rules.paymentsMode,
    paused: status.paused, cutoverAt: status.cutoverAt, tills: { acknowledged: status.acknowledged, pending: status.pending },
    directPanels: panels ?? [],
    canEdit: rules.canEdit, settingsId: rules.settingsId,
  };
}

/** Raising a sale switch needs new payments on and every till reloaded (the server checks the same). */
export function salesUnlocked(view: RulesView) {
  return view.mode === "attempts" && view.tills.acknowledged.length > 0 && view.tills.pending.length === 0;
}

export function useRulesCommands() {
  return {
    updateRules: useMutation(api.commerce.settings.updateRules),
    setPaused: useMutation(api.commerce.paymentCutover.setPaused),
    activate: useMutation(api.commerce.paymentCutover.activate),
    reconcileDirectPanel: useMutation(api.commerce.paymentCutover.reconcileDirectPanel),
    retireTill: useMutation(api.commerce.paymentCutover.retireTill),
  };
}

/**
 * One request key per intent: a retry of the same edit (after a lost answer) sends the same key, so
 * the server applies it once; a different edit gets a new key.
 */
export function useIntentKey() {
  const current = useRef<{ signature: string; key: string } | null>(null);
  return {
    key(signature: string) {
      if (current.current?.signature !== signature) current.current = { signature, key: crypto.randomUUID() };
      return current.current.key;
    },
    reset() { current.current = null; },
  };
}
