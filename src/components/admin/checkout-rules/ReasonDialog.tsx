"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReasonField } from "@/components/ui/reason-field";
import { Spinner } from "@/components/ui/spinner";
import { refusalText, t } from "./checkout-rules-copy";
import { useIntentKey } from "./use-checkout-rules";

/** 44 × 44 at every pointer (fine-pointer desktops too): reason chips, inputs and Close. */
const RULE_TARGETS = "[&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_textarea]:min-h-11 [&_[data-slot=dialog-close]]:size-11";

export type ReasonSubmit = (input: { reason: string; clientKey: string }) => Promise<unknown>;

/**
 * Every change on this page asks for a reason (D19/D20). `signature` names the edit: the same edit
 * retried after a lost answer reuses its request key. `problem` draws a refusal that needs more than
 * one sentence, such as the open payments list; otherwise the refusal shows as one line.
 */
export function ReasonDialog({
  title, description, children, chips, initialReason = "", confirmLabel, signature, onSubmit, onDone, onClose, problem,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  chips: readonly string[];
  initialReason?: string;
  confirmLabel: string;
  signature: string;
  onSubmit: ReasonSubmit;
  onDone: () => void;
  onClose: () => void;
  problem?: (err: unknown) => ReactNode | null;
}) {
  const [reason, setReason] = useState(initialReason);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ err: unknown } | null>(null);
  const [missing, setMissing] = useState(false);
  const intent = useIntentKey();

  async function confirm() {
    if (pending) return;
    const text = reason.trim();
    if (!text) { setMissing(true); return; }
    setPending(true);
    setFailure(null);
    try {
      await onSubmit({ reason: text, clientKey: intent.key(`${signature}|${text}`) });
      intent.reset();
      onDone();
    } catch (err) {
      setFailure({ err });
    } finally {
      setPending(false);
    }
  }

  const detail = failure ? problem?.(failure.err) ?? null : null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent data-testid="rules-dialog" className={RULE_TARGETS} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <ReasonField
          label={t("rules.reason")}
          value={reason}
          onChange={(value) => { setReason(value); setMissing(false); }}
          chips={chips}
          disabled={pending}
          error={missing ? t("rules.reasonRequired") : null}
        />
        {failure ? (
          <div role="alert" className="grid gap-2 text-sm text-destructive" data-testid="rules-refusal">
            <p>{refusalText(failure.err)}</p>
            {detail}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={onClose}>{t("rules.cancel")}</Button>
          <Button type="button" className="h-11" disabled={pending} onClick={confirm}>
            {pending ? <Spinner label={confirmLabel} className="text-current" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
