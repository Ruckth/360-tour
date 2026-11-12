"use client";

import { parseMoneyInput } from "@/lib/money-input";
import type { Id } from "convex/_generated/dataModel";
import { validateSpend, type ReportSpend, type SpendDraft } from "convex/lib/marketingReport";
import { Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "../ConfirmDialog";
import { useMarketingAccess } from "./MarketingAccess";
import { FieldError, FieldHint, NumberField } from "./MarketingBits";
import { wholeText } from "./coupon-form";
import { bangkokToday, formatRange, marketingErrorText, thb } from "./marketing-format";

/**
 * Release 3b contract: add or edit one spend entry. Used from the campaign sheet's Spend section and
 * from the dashboard's "Add spend". Validation is `validateSpend` from convex/lib/marketingReport.
 * Layout follows the "Add spend" dialog in docs/previews/marketing/src/dashboard.html and the
 * "Edit · spend" state in coupons-campaigns.html.
 */
export type SpendDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Campaigns to choose from. With exactly one (opened from its campaign sheet) the picker is hidden. */
  campaigns: { id: Id<"marketingCampaigns">; name: string }[];
  /** The entry being edited; absent = add. */
  entry?: ReportSpend;
  /** Prefill when adding. Default: this month so far in Bangkok, the first campaign, no amount. */
  defaults?: Partial<SpendDraft>;
  /** Resolves when saved; rejects with the server's message, which the dialog shows. */
  onSave: (draft: SpendDraft & { id?: Id<"marketingSpend"> }) => Promise<void>;
  /** Shown only when editing. */
  onDelete?: (id: Id<"marketingSpend">) => Promise<void>;
  /** Fixed clock for tests and fixtures. */
  now?: number;
};

export function SpendDialog(props: SpendDialogProps) {
  const { capabilities } = useMarketingAccess();
  if (!capabilities.spend) return null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted only while open, so every open starts from the entry or the defaults. */}
      {props.open ? <SpendForm {...props} /> : null}
    </Dialog>
  );
}

type Field = "campaign" | "amount" | "dates" | "note";
const VALID = { amount: 1, from: "2000-01-01", to: "2000-01-01" };

function SpendForm({ onOpenChange, campaigns, entry, defaults, onSave, onDelete, now }: SpendDialogProps) {
  const id = useId();
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const confirm = useConfirm();
  const [form, setForm] = useState(() => {
    const today = bangkokToday(now ?? Date.now());
    const start = entry ?? defaults;
    return {
      campaignId: (start?.campaignId ?? campaigns[0]?.id ?? "") as string,
      amount: wholeText(start?.amount === undefined ? undefined : start.amount / 100),
      from: start?.from ?? `${today.slice(0, 8)}01`,
      to: start?.to ?? today,
      note: start?.note ?? "",
    };
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [serverError, setServerError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const amount = parseMoneyInput(form.amount.replaceAll(",", ""));
  const note = form.note.trim();
  // validateSpend returns the first problem only; checking each field against otherwise valid values shows them all at once.
  const errors: Record<Field, string> = {
    campaign: form.campaignId ? "" : "Choose a campaign.",
    amount: validateSpend({ ...VALID, amount }) ?? "",
    dates: validateSpend({ ...VALID, from: form.from, to: form.to }) ?? "",
    note: validateSpend({ ...VALID, note }) ?? "",
  };
  const firstError = (Object.keys(errors) as Field[]).find((key) => errors[key]);
  const shown = (key: Field) => (submitted ? errors[key] : "");
  const campaignName = campaigns.find((campaign) => campaign.id === form.campaignId)?.name;
  const showPicker = campaigns.length > 1;
  const days = form.from && form.to && form.from <= form.to ? formatRange(form.from, form.to) : "";

  async function save(event: FormEvent) {
    event.preventDefault();
    // React events bubble through portals: keep this submit away from a form the dialog was opened from.
    event.stopPropagation();
    setSubmitted(true);
    setServerError("");
    if (firstError) {
      const target = { campaign: `${id}-campaign`, amount: `${id}-amount`, dates: `${id}-from`, note: `${id}-note` }[firstError];
      document.getElementById(target)?.focus();
      return;
    }
    setBusy("save");
    try {
      await onSave({ id: entry?.id, campaignId: form.campaignId as Id<"marketingCampaigns">, amount, from: form.from, to: form.to, note: note || undefined });
      onOpenChange(false);
    } catch (error) {
      setServerError(marketingErrorText(error, "Couldn’t save the spend."));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!entry || !onDelete) return;
    const confirmed = await confirm({
      title: `Delete ${thb(entry.amount)} of spend?`,
      description: `${formatRange(entry.from, entry.to)}. It leaves every report; the change history keeps it.`,
      confirmLabel: "Delete spend",
      destructive: true,
    });
    if (!confirmed) return;
    setServerError("");
    setBusy("delete");
    try {
      await onDelete(entry.id);
      onOpenChange(false);
    } catch (error) {
      setServerError(marketingErrorText(error, "Couldn’t delete the spend."));
    } finally {
      setBusy(null);
    }
  }

  const describe = (key: Field, hint = false) => ({
    "aria-invalid": shown(key) ? true : undefined,
    "aria-describedby": [`${id}-${key}-error`, hint && `${id}-${key}-hint`].filter(Boolean).join(" "),
  });

  return (
    <DialogContent
      className="max-w-lg"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        // Back to whatever opened the dialog, unless focus already moved on (say, into a menu opened meanwhile).
        const active = document.activeElement;
        if (!active || active === document.body || document.getElementById(`${id}-form`)?.contains(active)) {
          if (opener?.isConnected) opener.focus();
        }
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document.getElementById(`${id}-amount`)?.focus();
      }}
    >
      <form id={`${id}-form`} noValidate onSubmit={save} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit spend" : "Add spend"}</DialogTitle>
          <DialogDescription>
            {showPicker || !campaignName ? "Enter what the campaign cost." : `Enter what ${campaignName} cost.`} ROAS uses it for the same dates.
          </DialogDescription>
        </DialogHeader>

        {showPicker ? (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-campaign`}>Campaign</Label>
            <Select value={form.campaignId} onValueChange={(value) => set("campaignId", value)}>
              <SelectTrigger id={`${id}-campaign`} className="h-10 w-full" {...describe("campaign")}>
                <SelectValue placeholder="Choose a campaign" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id={`${id}-campaign-error`}>{shown("campaign")}</FieldError>
          </div>
        ) : (
          <FieldError id={`${id}-campaign-error`}>{shown("campaign")}</FieldError>
        )}

        <div className="grid gap-2">
          <Label htmlFor={`${id}-amount`}>
            Amount <span className="font-normal text-muted-foreground">(THB, incl. VAT)</span>
          </Label>
          <NumberField inputMode="decimal" id={`${id}-amount`} prefix="฿" placeholder="12,000" value={form.amount} onChange={(event) => set("amount", event.target.value)} {...describe("amount")} />
          <FieldError id={`${id}-amount-error`}>{shown("amount")}</FieldError>
        </div>

        <fieldset className="grid min-w-0 gap-2" aria-describedby={`${id}-dates-error ${id}-dates-hint`}>
          <legend className="mb-2 text-sm font-medium text-foreground">Dates the spend covers</legend>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
                From
              </Label>
              <DatePicker id={`${id}-from`} value={form.from} onValueChange={(value) => set("from", value)} placeholder="Start" {...describe("dates")} />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
                To
              </Label>
              <DatePicker id={`${id}-to`} value={form.to} onValueChange={(value) => set("to", value)} min={form.from || undefined} placeholder="End" {...describe("dates")} />
            </div>
          </div>
          <FieldError id={`${id}-dates-error`}>{shown("dates")}</FieldError>
          <FieldHint id={`${id}-dates-hint`}>
            {days ? `${days}, inclusive. ` : ""}Spread evenly across these days, in Asia/Bangkok time.
          </FieldHint>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor={`${id}-note`}>
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id={`${id}-note`} rows={2} value={form.note} onChange={(event) => set("note", event.target.value)} placeholder="Invoice number or what it paid for" {...describe("note")} />
          <FieldError id={`${id}-note-error`}>{shown("note")}</FieldError>
        </div>

        <p className="text-xs text-muted-foreground">Entered by hand; nothing is imported from ad platforms.</p>

        {serverError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {serverError}
          </p>
        ) : null}

        <DialogFooter className="sm:items-center">
          {entry && onDelete ? (
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void remove()} className="text-destructive hover:text-destructive sm:me-auto">
              {busy === "delete" ? <Spinner label="Deleting" className="text-current" /> : <Trash2 aria-hidden className="size-4" />}
              Delete
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy !== null}>
            {busy === "save" ? <Spinner label="Saving" className="text-current" /> : null}
            {entry ? "Save changes" : "Add spend"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
