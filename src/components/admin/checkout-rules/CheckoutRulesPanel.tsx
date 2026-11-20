"use client";

import { History, Scale } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Toast, useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useStaffAccess } from "@/components/admin/staff-access";
import { TONES } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";
import { t } from "./checkout-rules-copy";
import { PaymentsCutover } from "./PaymentsCutover";
import { RulesHistory } from "./RulesHistory";
import { SaleSwitches } from "./SaleSwitches";
import { TermsForm } from "./TermsForm";
import { salesUnlocked, useCheckoutRules } from "./use-checkout-rules";

/**
 * Settings › Checkout rules (D20): the payments cutover, what checkout can sell, and the rules that
 * depend on law, tax or accounting. The owner changes everything; a manager runs the cutover and
 * sees the switches. Cashiers never reach Settings.
 */
export function CheckoutRulesPanel({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const access = useStaffAccess();
  const owner = access.capabilities.settings;
  const view = useCheckoutRules(access.capabilities.approve);
  const toast = useToast();
  if (!access.capabilities.approve) return null;

  const cutover = view ? <PaymentsCutover view={view} onSaved={toast.show} /> : null;
  // Until the cutover is finished it comes first; then what checkout can sell leads.
  const cutoverFirst = !view || !salesUnlocked(view);

  return (
    <section role="region" aria-label={t("admin.checkoutRules")} className="grid gap-5" data-testid="checkout-rules">
      <header className="px-1 pt-1">
        <h2 className="flex flex-wrap items-center gap-3 font-serif text-3xl text-foreground">
          {t("admin.checkoutRules")}
          {owner ? <StatusBadge tone="warning" label={t("rules.ownerOnly")} className="font-sans" /> : null}
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{t("rules.intro")}</p>
      </header>

      <div role="note" className={cn("flex items-start gap-2.5 rounded-xl border p-4 text-sm", TONES.info.bg, TONES.info.text, TONES.info.border)}>
        <Scale aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="grid gap-1">
          <p className="font-semibold">{t("admin.rulesDisclaimer")}</p>
          {!owner ? <p>{t("rules.managerNote")}</p> : null}
        </div>
      </div>

      {!view ? (
        <div className="grid place-items-center py-10"><Spinner label={t("rules.loading")} className="size-5" /></div>
      ) : (
        <>
          {cutoverFirst ? cutover : null}
          <SaleSwitches view={view} onSaved={toast.show} />
          {cutoverFirst ? null : cutover}
          <TermsForm terms={view.terms} revision={view.revision} readOnly={!view.canEdit} onSaved={toast.show} onDirtyChange={onDirtyChange} />
          <Card role="region" aria-labelledby="rules-history-title" className="grid gap-3 p-5 lg:p-6" data-testid="rules-history">
            <div className="grid gap-1">
              <h3 id="rules-history-title" className="flex items-center gap-2 text-[15px] font-semibold">
                <History aria-hidden className="size-4 text-muted-foreground" />{t("rules.historyTitle")}
              </h3>
              <p className="text-[13px] leading-5 text-muted-foreground">{t("rules.historyHint")}</p>
            </div>
            <RulesHistory settingsId={view.settingsId} />
          </Card>
        </>
      )}
      <Toast current={toast.current} busy={toast.busy} error={toast.error} run={toast.run} dismiss={toast.dismiss} />
    </section>
  );
}
