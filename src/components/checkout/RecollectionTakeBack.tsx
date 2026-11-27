"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueries } from "convex/react";
import { api } from "convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { ReturnLotChoice } from "./ReturnLotChoice";
import { newAttemptKey, type OrderLine, type OrderView } from "./backend";
import { returnRefusal } from "./returnable-parts";
import { confirmedReturnLots, type Choice } from "./returns-desk";

type Handover = NonNullable<OrderView["commerce"]>["handovers"][number];
type Request = FunctionArgs<typeof api.pos.commands.adjust.adjust>;
type LotResult = FunctionReturnType<typeof api.pos.commands.adjust.takeBackLots>;

const available = (item: NonNullable<Handover["contents"]>[number]) => Math.min(item.unpaid, item.withGuest);

export function RecollectionTakeBack({ handover, line, disabled }: { handover: Handover; line: OrderLine; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="mx-3 mb-3" disabled={disabled}>Take back items</Button>
      </DialogTrigger>
      {open ? <TakeBackForm handover={handover} line={line} disabled={disabled} saving={saving} onSaving={setSaving} onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function TakeBackForm({ handover, line, disabled, saving, onSaving, onClose }: {
  handover: Handover; line: OrderLine; disabled: boolean; saving: boolean;
  onSaving: (saving: boolean) => void; onClose: () => void;
}) {
  const id = useId();
  const adjust = useMutation(api.pos.commands.adjust.adjust);
  const contents = handover.contents?.filter(item => available(item) > 0) ?? [];
  const [contentKey, setContentKey] = useState(contents[0]?.contentKey ?? "");
  const [choice, setChoice] = useState<Choice>({ units: 1, condition: null });
  const [reason, setReason] = useState("");
  const [revision] = useState(handover.revision);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const sent = useRef<Request | null>(null);
  const lock = useRef(false);
  const item = contents.find(content => content.contentKey === contentKey);
  const max = item ? available(item) : 0;
  const stale = handover.revision !== revision;
  const sellable = choice.condition === "sellable";
  const lots: LotResult | Error | undefined = useQueries(sellable && item && !stale && !disabled
    ? { options: { query: api.pos.commands.adjust.takeBackLots, args: { handoverId: handover._id, contentKey } } }
    : {}).options;
  const options = lots && !(lots instanceof Error) ? lots : null;
  const lotAllocations = options?.tracked ? confirmedReturnLots(options.lots, choice) : undefined;
  const validLots = !sellable || (options !== null && lotAllocations !== null);
  const ready = !stale && !disabled && Boolean(item && choice.condition && reason.trim() && validLots) &&
    Number.isSafeInteger(choice.units) && choice.units >= 1 && choice.units <= max;
  const frozen = saving || uncertain || stale || disabled;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || disabled || (!ready && !uncertain)) return;
    const { condition, units } = choice;
    if (condition !== "sellable" && condition !== "damaged") return;
    sent.current ??= {
      target: { targetType: "handover", targetId: handover._id }, kind: "takeBack",
      input: { contentKey, quantity: units, disposition: condition, ...(lotAllocations ? { lotAllocations } : {}) },
      expectedRevision: revision, clientKey: newAttemptKey(), reasonCode: "other", reasonText: reason.trim(),
    };
    lock.current = true;
    onSaving(true);
    setError("");
    try {
      const result = await adjust(sent.current);
      if (result.status === "applied") onClose();
      else {
        sent.current = null;
        setUncertain(false);
        setError("This take-back requires approval.");
      }
    } catch (failure) {
      const refusal = returnRefusal(failure);
      if (refusal) sent.current = null;
      setUncertain(!refusal);
      setError(refusal?.message || "Couldn’t confirm the take-back. Retry to check the same request.");
    } finally {
      lock.current = false;
      onSaving(false);
    }
  }

  return (
    <CheckoutDialogContent showCloseButton={!saving} className="max-h-[90dvh] max-w-md overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Take back items</DialogTitle>
        <DialogDescription>{line.name} · Record items received from the guest and update the balance due.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-item`}>Item</Label>
          <select id={`${id}-item`} className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={contentKey}
            disabled={frozen || contents.length < 2} onChange={event => { setContentKey(event.target.value); setChoice({ units: 1, condition: null }); }}>
            {contents.map(content => (
              <option key={content.contentKey} value={content.contentKey}>
                {line.saleSnapshot?.contents.find(part => part.contentKey === content.contentKey)?.label ?? content.contentKey}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-units`}>Units received ({max} available)</Label>
          <Input id={`${id}-units`} type="number" min={1} max={max} step={1} value={choice.units || ""} disabled={frozen}
            onChange={event => setChoice({ ...choice, units: event.target.valueAsNumber || 0 })} />
        </div>
        <div role="group" aria-label="Condition of returned items" className="flex flex-wrap gap-2">
          {([["sellable", "Back to stock"], ["damaged", "Damaged"]] as const).map(([condition, label]) => (
            <Button key={condition} type="button" size="sm" variant={choice.condition === condition ? "default" : "outline"}
              aria-pressed={choice.condition === condition} disabled={frozen} onClick={() => setChoice({ units: choice.units, condition })}>{label}</Button>
          ))}
        </div>
        {sellable && options?.tracked && choice.units > 0
          ? <ReturnLotChoice options={options.lots} choice={choice} disabled={frozen} onChange={setChoice} /> : null}
        {sellable && !stale && !disabled && !lots ? <p role="status" className="text-sm text-muted-foreground">Checking original lots…</p> : null}
        {lots instanceof Error ? <p role="alert" className="text-sm text-destructive">Couldn’t read the original lots for this charge.</p> : null}
        <div className="grid gap-2">
          <Label htmlFor={`${id}-reason`}>Reason</Label>
          <Input id={`${id}-reason`} value={reason} maxLength={500} disabled={frozen} onChange={event => setReason(event.target.value)} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {stale && !uncertain ? <p role="status" className="text-sm text-muted-foreground">This charge changed. Reopen take-back to see the current quantities.</p> : null}
        {disabled ? <p role="status" className="text-sm text-muted-foreground">Finish the active payment or order change before taking back items.</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving || disabled || (!ready && !uncertain)}>
            {saving ? "Saving…" : uncertain ? "Retry take-back" : "Record take-back"}
          </Button>
        </DialogFooter>
      </form>
    </CheckoutDialogContent>
  );
}
