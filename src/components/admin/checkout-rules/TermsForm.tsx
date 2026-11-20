"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { NumberField } from "@/components/admin/marketing/MarketingBits";
import { cn } from "@/lib/utils";
import { t } from "./checkout-rules-copy";
import { ReasonDialog } from "./ReasonDialog";
import { useRulesCommands, type Terms } from "./use-checkout-rules";

type Choice = { id: string; kind: "choice"; copy: string; options: readonly (readonly [string, string])[]; read: (terms: Terms) => string; write: (value: string) => Partial<Terms>; loyalty?: boolean };
type Count = { id: string; kind: "count"; copy: string; unit: "days" | "months"; min: number; read: (terms: Terms) => number | null; write: (value: number, terms: Terms) => Partial<Terms>; loyalty?: boolean };
type Rule = Choice | Count;

/** The D20 settings, in v27's order, with v27's defaults (D2, D3, D7, D1, D9, L7, L8). */
const RULES: readonly Rule[] = [
  { id: "expiry", kind: "choice", copy: "terms.expiry", options: [["keep", "terms.expiry.keep"], ["forfeit", "terms.expiry.forfeit"]], read: (x) => (x.preserveExpiredPackageValue ? "keep" : "forfeit"), write: (v) => ({ preserveExpiredPackageValue: v === "keep" }) },
  { id: "fullRefund", kind: "count", copy: "terms.fullRefund", unit: "days", min: 0, read: (x) => x.unusedFullRefundDays, write: (v) => ({ unusedFullRefundDays: v }) },
  { id: "dueCash", kind: "count", copy: "terms.dueCash", unit: "days", min: 0, read: (x) => x.refundDueDays.cashOrTransfer, write: (v, x) => ({ refundDueDays: { ...x.refundDueDays, cashOrTransfer: v } }) },
  { id: "dueCard", kind: "count", copy: "terms.dueCard", unit: "days", min: 0, read: (x) => x.refundDueDays.card, write: (v, x) => ({ refundDueDays: { ...x.refundDueDays, card: v } }) },
  { id: "packageDays", kind: "count", copy: "terms.packageDays", unit: "days", min: 1, read: (x) => x.packageValidityDays, write: (v) => ({ packageValidityDays: v }) },
  { id: "voucherDays", kind: "count", copy: "terms.voucherDays", unit: "days", min: 1, read: (x) => x.voucherValidityDays, write: (v) => ({ voucherValidityDays: v }) },
  { id: "passOn", kind: "choice", copy: "terms.passOn", options: [["allow", "terms.passOn.allow"], ["no", "terms.passOn.no"]], read: (x) => (x.allowSessionTransfer ? "allow" : "no"), write: (v) => ({ allowSessionTransfer: v === "allow" }) },
  { id: "split", kind: "choice", copy: "terms.split", options: [["voucherFaceValue", "terms.split.face"], ["normalPrice", "terms.split.normal"]], read: (x) => x.packageSplit, write: (v) => ({ packageSplit: v as Terms["packageSplit"] }) },
  { id: "vat", kind: "choice", copy: "terms.vat", options: [["atSale", "terms.vat.sale"], ["atUse", "terms.vat.use"]], read: (x) => x.packageVatTiming, write: (v) => ({ packageVatTiming: v as Terms["packageVatTiming"] }) },
  { id: "points", kind: "choice", copy: "terms.points", loyalty: true, options: [["discount", "terms.points.discount"], ["payment", "terms.points.payment"]], read: (x) => x.pointsVatTreatment, write: (v) => ({ pointsVatTreatment: v as Terms["pointsVatTreatment"] }) },
  { id: "pointsExpiry", kind: "count", copy: "terms.pointsExpiry", unit: "months", min: 1, loyalty: true, read: (x) => x.pointsExpiryMonths, write: (v) => ({ pointsExpiryMonths: v }) },
];

export const DEFAULT_TERMS: Terms = {
  preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 },
  packageValidityDays: 180, voucherValidityDays: 365, allowSessionTransfer: true, packageSplit: "voucherFaceValue",
  packageVatTiming: "atSale", pointsVatTreatment: "discount", pointsExpiryMonths: 12,
};

type Draft = Record<string, string>;

/** A stored null (no refund window, unlimited voucher validity) shows as an empty field. */
const textOf = (value: string | number | null) => (value === null ? "" : String(value));
const draftOf = (terms: Terms): Draft => Object.fromEntries(RULES.map((rule) => [rule.id, textOf(rule.read(terms))]));
const valueText = (rule: Rule, value: string) => rule.kind === "choice"
  ? t(rule.options.find(([option]) => option === value)?.[1] ?? rule.options[0][1])
  : value === "" ? "—" : t(`rules.${rule.unit}`, { count: Number(value) });
/** Which rule each stored settings field is, for History (Settings › Checkout rules). */
const FIELD_RULES: Record<string, string> = {
  preserveExpiredPackageValue: "expiry", unusedFullRefundDays: "fullRefund", "refundDueDays.cashOrTransfer": "dueCash",
  "refundDueDays.card": "dueCard", packageValidityDays: "packageDays", voucherValidityDays: "voucherDays",
  allowSessionTransfer: "passOn", packageSplit: "split", packageVatTiming: "vat", pointsVatTreatment: "points",
  pointsExpiryMonths: "pointsExpiry",
};
type Stored = string | number | boolean | null;

/** One changed rule or sale switch in words: "Refund due · card: 45 days → 30 days". null for a field this page doesn't show. */
export function ruleChangeText({ field, before, after }: { field: string; before: Stored; after: Stored }): string | null {
  if (field.startsWith("saleSwitches.")) {
    const state = (value: Stored) => (typeof value === "string" ? t(`switches.${value}`) : "—");
    return t("rules.historyChange", { label: t(`kinds.${field.slice("saleSwitches.".length)}`), before: state(before), after: state(after) });
  }
  const rule = RULES.find((item) => item.id === FIELD_RULES[field]);
  if (!rule) return null;
  // Yes/no rules store a boolean; their first option is "yes".
  const text = (value: Stored) => value === null ? "—"
    : valueText(rule, typeof value === "boolean" && rule.kind === "choice" ? rule.options[value ? 0 : 1][0] : String(value));
  return t("rules.historyChange", { label: t(`${rule.copy}.label`), before: text(before), after: text(after) });
}

function countError(rule: Count, value: string) {
  if (!/^\d+$/.test(value.trim())) return t("rules.wholeNumber");
  return Number(value) < rule.min ? t("rules.atLeastOne") : null;
}
const sameTerms = (a: Terms, b: Terms) => JSON.stringify(draftOf(a)) === JSON.stringify(draftOf(b));

/**
 * The D20 rules: each says what it changes, who it affects and its default. The owner saves with a
 * reason; the change applies to sales made after it. If the rules change on another screen while
 * a draft is open, the draft is kept and Load current rules starts again from the saved ones.
 */
export function TermsForm({ terms, revision, readOnly = false, onSaved, onDirtyChange }: { terms: Terms; revision: number; readOnly?: boolean; onSaved: (message: string) => void; onDirtyChange: (dirty: boolean) => void }) {
  const { updateRules } = useRulesCommands();
  const [base, setBase] = useState({ terms, revision });
  const [draft, setDraft] = useState(() => draftOf(terms));
  const [confirming, setConfirming] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const changes = RULES.filter((rule) => draft[rule.id] !== textOf(rule.read(base.terms)));
  const dirty = changes.length > 0;
  const stale = revision !== base.revision && !sameTerms(terms, base.terms);
  const errors = Object.fromEntries(RULES.flatMap((rule) => {
    // Only what is being changed is checked: a saved empty (no limit) value doesn't block other edits.
    const changed = draft[rule.id] !== textOf(rule.read(base.terms));
    const error = rule.kind === "count" && changed ? countError(rule, draft[rule.id]) : null;
    return error ? [[rule.id, error]] : [];
  }));

  // Follow the saved rules while rendering: at once when nothing is drafted, and keep the draft's
  // base revision current when only something else (a switch, the pause) moved the revision.
  if (revision !== base.revision && (!dirty || sameTerms(terms, base.terms))) {
    setBase({ terms, revision });
    if (!dirty) setDraft(draftOf(terms));
  }
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);

  const loadCurrent = () => { setBase({ terms, revision }); setDraft(draftOf(terms)); setShowErrors(false); };
  const patch = () => changes.reduce<Partial<Terms>>((acc, rule) => {
    const value = draft[rule.id];
    const current = { ...base.terms, ...acc } as Terms;
    return { ...acc, ...(rule.kind === "choice" ? rule.write(value) : rule.write(Number(value), current)) };
  }, {});
  const openSave = () => {
    if (Object.keys(errors).length) { setShowErrors(true); return; }
    setConfirming(true);
  };

  return (
    <Card role="region" aria-labelledby="rules-terms-title" className="grid gap-0 p-0" data-testid="terms-form">
      <header className="grid gap-1 px-5 pt-5 pb-4 lg:px-6 lg:pt-6">
        <h3 id="rules-terms-title" className="text-[15px] font-semibold">{t("rules.rulesTitle")}</h3>
        <p className="text-pretty text-[13px] leading-5 text-muted-foreground">{t("admin.rulesApplyToNewSales")}{readOnly ? ` ${t("rules.rulesOwnerOnly")}` : ""}</p>
      </header>
      {stale ? (
        <Alert variant="warning" className="mx-5 mb-4 lg:mx-6" data-testid="rules-stale">
          <AlertDescription className="grid gap-2">
            <span className="block"><strong className="font-semibold">{t("rules.staleTitle")}</strong> {t("rules.staleDraft")}</span>
            <Button type="button" variant="outline" className="h-11 justify-self-start" onClick={loadCurrent}>{t("rules.loadCurrent")}</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y divide-border border-t border-border">
        {RULES.map((rule) => {
          const id = `rules-${rule.id}`;
          const label = t(`${rule.copy}.label`);
          const error = showErrors ? errors[rule.id] : undefined;
          const changed = draft[rule.id] !== textOf(rule.read(base.terms));
          return (
            <li key={rule.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-center md:gap-6 lg:px-6" data-testid={`rule-${rule.id}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {rule.kind === "count" ? <label htmlFor={id}>{label}</label> : <span id={`${id}-label`}>{label}</span>}
                  {rule.loyalty ? <StatusBadge tone="info" label={t("rules.loyaltyRelease")} /> : null}
                  {changed ? <StatusBadge tone="accent" label={t("rules.changed")} /> : null}
                </p>
                <p id={`${id}-hint`} className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">
                  {t(`${rule.copy}.hint`)} {t("rules.affects", { who: t(`${rule.copy}.affects`) })}{" "}
                  <span className="whitespace-nowrap">{t("rules.defaultIs", { value: valueText(rule, textOf(rule.read(DEFAULT_TERMS))) })}</span>
                </p>
              </div>
              <div className="min-w-0">
                {rule.kind === "choice" ? (
                  <ToggleGroup
                    aria-labelledby={`${id}-label`}
                    aria-describedby={`${id}-hint`}
                    value={draft[rule.id]}
                    disabled={readOnly}
                    onValueChange={(value) => { if (!readOnly) setDraft((current) => ({ ...current, [rule.id]: value })); }}
                    className="w-full"
                  >
                    {rule.options.map(([value, copy]) => (
                      <ToggleGroupItem key={value} value={value} className="min-h-11 flex-1 text-balance text-center text-sm leading-tight">{t(copy)}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : (
                  <div className="md:max-w-56">
                    <NumberField
                      id={id}
                      value={draft[rule.id]}
                      readOnly={readOnly}
                      suffix={rule.unit === "days" ? "days" : "months"}
                      aria-describedby={[`${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ")}
                      aria-invalid={error ? true : undefined}
                      onChange={(event) => { if (!readOnly) setDraft((current) => ({ ...current, [rule.id]: event.target.value })); }}
                      className={cn("h-11 pr-20 tabular-nums", error && "border-destructive")}
                    />
                    {error ? <p id={`${id}-error`} className="mt-1 text-xs text-destructive">{error}</p> : null}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {dirty ? (
        <StickyActionBar data-testid="rules-save-bar" className="mx-0 rounded-none border-x-0 border-b-0 sm:rounded-b-xl sm:rounded-t-none sm:border-0 sm:border-t sm:shadow-none">
          <span role="status" className="mr-auto text-sm text-muted-foreground">{t("rules.unsaved", { count: changes.length })}</span>
          <Button type="button" variant="ghost" className="h-11" onClick={loadCurrent}>{t("rules.discard")}</Button>
          <Button type="button" className="h-11" onClick={openSave}>{t("rules.save")}</Button>
        </StickyActionBar>
      ) : null}

      {confirming ? (
        <ReasonDialog
          title={t("rules.saveTitle", { count: changes.length })}
          description={t("rules.saveHint")}
          chips={[t("rules.reasons.policy"), t("rules.reasons.adviser"), t("rules.reasons.correction")]}
          confirmLabel={t("rules.save")}
          signature={`terms:${base.revision}:${JSON.stringify(patch())}`}
          onSubmit={({ reason, clientKey }) => updateRules({ expectedRevision: base.revision, clientKey, reason, terms: patch() })}
          onDone={() => {
            setConfirming(false);
            // Mark the draft as saved now; the live query brings the new revision a moment later.
            setBase((current) => ({ ...current, terms: { ...current.terms, ...patch() } }));
            onSaved(t("rules.saved"));
          }}
          onClose={() => setConfirming(false)}
        >
          <section aria-label={t("rules.beforeAfter")} className="grid gap-2 rounded-xl border border-gold/70 bg-gold/5 p-3" data-testid="rules-diff">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("rules.beforeAfter")}</p>
            {changes.map((rule) => (
              <p key={rule.id} className="text-sm">
                <span className="text-muted-foreground">{t(`${rule.copy}.label`)} · {valueText(rule, textOf(rule.read(base.terms)))}</span>{" "}
                <ArrowRight aria-label="to" className="inline size-3.5 align-[-2px] text-gold-text" />{" "}
                <strong className="font-semibold">{valueText(rule, draft[rule.id])}</strong>
              </p>
            ))}
          </section>
        </ReasonDialog>
      ) : null}
    </Card>
  );
}
