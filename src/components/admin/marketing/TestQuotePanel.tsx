"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { TONES } from "../status-tones";
import { Callout, FieldError, NumberField, SideCard, nextEditorKey } from "./MarketingBits";
import { parseWhole } from "./coupon-form";
import { directOfferApplied, formatDay, marketingErrorText, nightsBetween, quoteVerdict, thb } from "./marketing-format";
import type { MarketingActions, MarketingProperty, OfferResult } from "./types";

type ServiceLine = { key: number; label: string; amount: string };
/** A run, with the inputs and the saved coupon (code and version) it was run against. */
type Tested = { key: number; label: string; checkIn: string; code: string; version?: number; result: OfferResult };

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Runs a quote through the shared offer engine with the coupon's saved rules (testQuote).
 * Nothing is held or booked; drafts and paused coupons can be tested too.
 */
export function TestQuotePanel({
  code,
  savedVersion,
  dirty,
  properties,
  today,
  testQuote,
}: {
  /** The saved code, or undefined before the coupon exists. */
  code?: string;
  savedVersion?: number;
  dirty: boolean;
  properties: MarketingProperty[];
  today: string;
  testQuote: MarketingActions["testQuote"];
}) {
  const id = useId();
  const villas = [...properties].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
  const [villa, setVilla] = useState(villas[0]?.slug ?? "");
  const [checkIn, setCheckIn] = useState(() => addDays(today, 5));
  const [checkOut, setCheckOut] = useState(() => addDays(today, 7));
  const [services, setServices] = useState<ServiceLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<Tested | null>(null);
  const [log, setLog] = useState<Tested[]>([]);

  // Results are kept, but a run against an older saved version or code no longer describes this coupon.
  const isStale = (tested: Tested) => tested.code !== code || tested.version !== savedVersion;
  const versionName = (tested: Tested) => `${tested.code}${tested.version ? ` v${tested.version}` : ""}`;

  const nights = nightsBetween(checkIn, checkOut);
  const villaInfo = properties.find((property) => property.slug === villa);
  const serviceErrors = services.map((line) => {
    const amount = parseWhole(line.amount);
    if (!line.label.trim() && !line.amount.trim()) return "";
    if (!line.label.trim()) return "Name the service";
    if (amount === undefined || Number.isNaN(amount) || amount <= 0) return "Enter the price in baht";
    return "";
  });
  const errors = {
    villa: villa ? "" : "Choose a villa",
    dates: !checkIn || !checkOut ? "Choose both dates" : nights < 1 ? "Check-out must be after check-in" : "",
  };
  const invalid = Boolean(errors.villa || errors.dates || serviceErrors.some(Boolean));

  async function run(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!code || invalid) return;
    setRunning(true);
    setError("");
    const lines = services
      .filter((line) => line.label.trim())
      .map((line) => ({ label: line.label.trim(), amount: (parseWhole(line.amount) ?? 0) * 100 }));
    try {
      const quote = await testQuote({ code, propertySlug: villa, checkIn, checkOut, services: lines.length ? lines : undefined });
      const label = `${villaInfo?.name ?? villa} · ${nights} ${nights === 1 ? "night" : "nights"}${lines.length ? ` + ${lines.length} service${lines.length === 1 ? "" : "s"}` : ""}`;
      const tested: Tested = { key: nextEditorKey(), label, checkIn, code, version: savedVersion, result: quote };
      setResult(tested);
      setLog((current) => [tested, ...current].slice(0, 5));
    } catch (err) {
      setError(marketingErrorText(err, "Couldn’t run the quote."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <SideCard id={`${id}-title`} title="Test a quote" description="Runs the saved rules through the same pricing as the guest checkout. Nothing is held or booked.">
      <form noValidate onSubmit={run} className="grid gap-4 p-4">
        {!code ? (
          <Callout>Save the coupon first. The test uses its saved rules.</Callout>
        ) : dirty ? (
          <Callout tone="warning">You have unsaved changes. This tests the saved version{savedVersion ? ` (v${savedVersion})` : ""}.</Callout>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor={`${id}-villa`}>Villa</Label>
          <Select value={villa} onValueChange={setVilla}>
            <SelectTrigger id={`${id}-villa`} className="h-10 w-full" aria-invalid={submitted && errors.villa ? true : undefined}>
              <SelectValue placeholder="Choose a villa" />
            </SelectTrigger>
            <SelectContent>
              {villas.map((property) => (
                <SelectItem key={property._id} value={property.slug}>
                  {property.name} · {thb(property.pricePerNight)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={`${id}-villa-error`}>{submitted ? errors.villa : ""}</FieldError>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-in`}>Check-in</Label>
            <DatePicker id={`${id}-in`} value={checkIn} onValueChange={setCheckIn} placeholder="Choose" />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-out`}>Check-out</Label>
            <DatePicker
              id={`${id}-out`}
              value={checkOut}
              onValueChange={setCheckOut}
              min={checkIn ? addDays(checkIn, 1) : undefined}
              placeholder="Choose"
              aria-invalid={submitted && errors.dates ? true : undefined}
              aria-describedby={`${id}-dates`}
            />
          </div>
          <p id={`${id}-dates`} className={cn("col-span-2 text-xs", submitted && errors.dates ? "font-medium text-destructive" : "text-muted-foreground")}>
            {submitted && errors.dates ? errors.dates : nights > 0 ? `${nights} ${nights === 1 ? "night" : "nights"}` : "Choose the stay"}
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium leading-none text-foreground">
            Services <span className="font-normal text-muted-foreground">(optional)</span>
          </legend>
          {services.map((line, index) => (
            <div key={line.key} className="grid gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                <Input
                  aria-label={`Service ${index + 1}`}
                  placeholder="e.g. Thai massage 60"
                  value={line.label}
                  onChange={(event) => setServices((current) => current.map((item) => (item.key === line.key ? { ...item, label: event.target.value } : item)))}
                />
                <NumberField
                  aria-label={`Price of service ${index + 1}`}
                  prefix="฿"
                  placeholder="0"
                  value={line.amount}
                  onChange={(event) => setServices((current) => current.map((item) => (item.key === line.key ? { ...item, amount: event.target.value } : item)))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove service ${index + 1}`}
                  onClick={() => setServices((current) => current.filter((item) => item.key !== line.key))}
                  className="text-muted-foreground"
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
              <FieldError id={`${id}-service-${line.key}`}>{submitted ? serviceErrors[index] : ""}</FieldError>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => setServices((current) => [...current, { key: nextEditorKey(), label: "", amount: "" }])}
          >
            <Plus aria-hidden className="size-4" />
            Add a service
          </Button>
        </fieldset>

        <Button type="submit" disabled={!code || running} className="w-full">
          {running ? <Spinner label="Running the quote" className="text-current" /> : null}
          Run quote
        </Button>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <div aria-live="polite" className="grid gap-3">
          {result && isStale(result) ? (
            <Callout tone="warning">
              Tested on {versionName(result)}. The coupon has changed since; run the quote again to see {code}
              {savedVersion ? ` v${savedVersion}` : ""}.
            </Callout>
          ) : null}
          {result ? <QuoteResult tested={result} stale={isStale(result)} /> : null}
        </div>

        {log.length > 1 ? (
          <div className="border-t border-border pt-3">
            <p className="admin-eyebrow">Tested</p>
            <ul className="mt-2 grid gap-1.5">
              {log.map((item) => {
                const verdict = quoteVerdict(item.result);
                return (
                  <li key={item.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={cn("min-w-0 flex-1 truncate", isStale(item) && "text-muted-foreground")}>
                      {item.label}
                      {isStale(item) ? ` · ${versionName(item)}` : ""}
                    </span>
                    <StatusBadge tone={verdict.tone} label={verdict.title} />
                    <span className="w-20 text-right font-semibold tabular-nums">{thb(item.result.total)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </form>
    </SideCard>
  );
}

const VERDICT_BOX = {
  success: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-400/30 dark:bg-emerald-400/10",
  warning: "border-amber-200 bg-amber-50/70 dark:border-amber-400/30 dark:bg-amber-400/10",
  info: "border-border bg-muted/50",
  neutral: "border-border bg-muted/50",
} as const;

function AppliedTag() {
  return (
    <span className={cn("ms-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold", TONES.success.bg, TONES.success.border, TONES.success.text)}>
      <Check aria-hidden className="size-3" />
      Applied
    </span>
  );
}

function QuoteResult({ tested, stale }: { tested: Tested; stale: boolean }) {
  const { result, label, checkIn, code } = tested;
  const couponWins = result.applied === "coupon";
  // A services coupon stacks with the direct offer, so both can be applied at once.
  const directWins = directOfferApplied(result);
  return (
    <div className={cn("grid gap-3", stale && "opacity-60")}>
      <div className="rounded-lg border border-border">
        <dl className="divide-y divide-border text-sm">
          <div className="flex items-start justify-between gap-3 px-3 py-2">
            <dt className="min-w-0">
              Subtotal
              <span className="block text-xs text-muted-foreground">
                {label} from {formatDay(checkIn)}
              </span>
            </dt>
            <dd className="shrink-0 tabular-nums">{thb(result.subtotal)}</dd>
          </div>
          <div className={cn("flex items-start justify-between gap-3 px-3 py-2", !directWins && "text-muted-foreground")}>
            <dt className="min-w-0">
              Direct-booking offer
              {directWins ? <AppliedTag /> : null}
            </dt>
            <dd className={cn("shrink-0 tabular-nums", directWins ? "font-semibold" : result.directDiscount ? "line-through" : "")}>
              {result.directDiscount ? `−${thb(result.directDiscount)}` : "—"}
            </dd>
          </div>
          <div className={cn("flex items-start justify-between gap-3 px-3 py-2", !couponWins && "text-muted-foreground")}>
            <dt className="min-w-0">
              <span className="font-mono text-xs font-semibold">{code}</span>
              {couponWins ? <AppliedTag /> : null}
              {result.capped ? <span className="block text-xs text-muted-foreground">Capped at the max saving</span> : null}
            </dt>
            <dd className={cn("shrink-0 tabular-nums", couponWins ? "font-semibold" : result.couponDiscount ? "line-through" : "")}>
              {result.couponStatus === "invalid" ? "Not applied" : result.couponDiscount ? `−${thb(result.couponDiscount)}` : "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
            <dt className="font-semibold">Total</dt>
            <dd className="text-base font-semibold tabular-nums">{thb(result.total)}</dd>
          </div>
        </dl>
      </div>
      <QuoteVerdictBox result={result} />
    </div>
  );
}

/** Which offer wins a quote, and why (quoteVerdict), in the status tones. Also used by New booking. */
export function QuoteVerdictBox({ result, children }: { result: OfferResult; children?: ReactNode }) {
  const verdict = quoteVerdict(result);
  return (
    <div role="status" className={cn("rounded-lg border px-3 py-2 text-sm", VERDICT_BOX[verdict.tone])}>
      <p className="font-semibold text-foreground">{verdict.title}</p>
      <p className="text-foreground/85">{verdict.detail}</p>
      {children}
    </div>
  );
}
