"use client";

import type { Id } from 'convex/_generated/dataModel';
import { addDays } from 'convex/shared/dates';

import { Check, Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { TONES } from "../status-tones";
import { Callout, FieldError, NumberField, SideCard, nextEditorKey } from "./MarketingBits";
import { parseWhole } from "./coupon-form";
import { directOfferApplied, formatDay, marketingErrorText, nightsBetween, quoteVerdict, thb } from "./marketing-format";
import type { CouponScope, MarketingActions, MarketingProperty, OfferResult } from "./types";

type ServiceLine = { key: number; serviceId: string; amount: string };
export type QuoteServiceCatalog = {
  choices: readonly { id: Id<"services">; name: string; category: string; durationMin: number }[];
  loading?: boolean;
  loadMore?: () => void;
};
type QuoteProposal = NonNullable<Parameters<MarketingActions["testQuote"]>[0]["proposed"]>;
type Tested = {
  key: number;
  identity: string;
  label: string;
  checkIn?: string;
  code: string;
  version?: number;
  isPreview: boolean;
  result: OfferResult;
};

export function TestQuotePanel({
  code,
  savedVersion,
  preview,
  scope = "accommodation",
  properties,
  today,
  testQuote,
  serviceCatalog,
}: {
  code?: string;
  savedVersion?: number;
  preview?: QuoteProposal & { key: string; validate: () => boolean };
  scope?: CouponScope;
  properties: MarketingProperty[];
  today: string;
  serviceCatalog?: QuoteServiceCatalog;
  testQuote: MarketingActions["testQuote"];
}) {
  const id = useId();
  const villas = [...properties].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
  const [villa, setVilla] = useState(villas[0]?.slug ?? "");
  const [includeStay, setIncludeStay] = useState(false);
  const [checkIn, setCheckIn] = useState(() => addDays(today, 5));
  const [checkOut, setCheckOut] = useState(() => addDays(today, 7));
  const [services, setServices] = useState<ServiceLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<Tested | null>(null);
  const [log, setLog] = useState<Tested[]>([]);

  const withStay = scope !== "services" || includeStay;
  const nights = nightsBetween(checkIn, checkOut);
  const villaInfo = properties.find((property) => property.slug === villa);
  const catalog = serviceCatalog?.choices ?? [];
  const validServices = new Map<string, Id<"services">>(catalog.map(({ id }) => [id, id]));
  const serviceErrors = services.map((line) => {
    const amount = parseWhole(line.amount);
    if (!line.serviceId) return "Choose a service";
    if (!validServices.has(line.serviceId)) return "This service is unavailable. Choose another service.";
    if (amount === undefined || Number.isNaN(amount) || amount <= 0) return "Enter the price in baht";
    return "";
  });
  const errors = {
    villa: withStay && !villaInfo ? "Choose a villa" : "",
    dates: withStay && (!checkIn || !checkOut) ? "Choose both dates" : withStay && nights < 1 ? "Check-out must be after check-in" : "",
    services: !withStay && !services.length ? "Add a service to run this quote." : "",
  };
  const invalid = Boolean(errors.villa || errors.dates || errors.services || serviceErrors.some(Boolean));
  const identity = JSON.stringify([
    code, savedVersion, preview?.key,
    withStay ? [villa, checkIn, checkOut] : null,
    services.map(({ serviceId, amount }) => [serviceId, parseWhole(amount), validServices.has(serviceId)]),
  ]);
  const isStale = (tested: Tested) => tested.identity !== identity;
  const versionName = (tested: Tested) => tested.isPreview ? `unsaved ${tested.code}` : `${tested.code}${tested.version ? ` v${tested.version}` : ""}`;

  async function run(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!code || running || (preview && !preview.validate()) || invalid) return;
    setRunning(true);
    setError(null);
    const lines = services.flatMap(({ serviceId, amount }) => {
      const id = validServices.get(serviceId);
      return id ? [{ serviceId: id, amount: (parseWhole(amount) ?? 0) * 100 }] : [];
    });
    try {
      const quote = await testQuote({
        code,
        ...(withStay && { propertySlug: villa, checkIn, checkOut }),
        ...(lines.length && { services: lines }),
        ...(preview && { proposed: { couponId: preview.couponId, rules: preview.rules } }),
      });
      const stay = withStay ? `${villaInfo?.name ?? villa} · ${nights} ${nights === 1 ? "night" : "nights"}` : "";
      const treatments = lines.length ? `${lines.length} service${lines.length === 1 ? "" : "s"}` : "";
      const label = [stay, treatments].filter(Boolean).join(" + ");
      const tested: Tested = {
        key: nextEditorKey(), identity, label, checkIn: withStay ? checkIn : undefined,
        code, version: savedVersion, isPreview: Boolean(preview), result: quote,
      };
      setResult(tested);
      setLog((current) => [tested, ...current].slice(0, 5));
    } catch (err) {
      setError({ identity, message: marketingErrorText(err, "Couldn’t run the quote.") });
    } finally {
      setRunning(false);
    }
  }

  return (
    <SideCard id={`${id}-title`} title="Test a quote" description={preview ? "Unsaved rules · preview only" : "Saved rules · preview only"}>
      <form noValidate onSubmit={run} className="grid gap-4 p-4">
        {!code ? <Callout>Enter a coupon code to run a preview</Callout> : null}
        {scope === "services" ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={includeStay} onChange={(event) => setIncludeStay(event.target.checked)} />
            Include a stay
          </label>
        ) : null}
        {scope !== "accommodation" ? (
          <p className="text-xs text-muted-foreground">Use this preview for booking and lodging dates, and verify treatment dates and desk eligibility separately.</p>
        ) : null}

        {withStay ? (
          <>
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
          </>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium leading-none text-foreground">
            Services {withStay ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
          </legend>
          {services.map((line, index) => (
            <div key={line.key} className="grid gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                <select
                  aria-label={`Service ${index + 1}`}
                  aria-describedby={`${id}-service-${line.key}`}
                  aria-invalid={submitted && !!serviceErrors[index]}
                  className="min-h-11 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                  value={line.serviceId}
                  onChange={(event) => setServices((current) => current.map((item) => item.key === line.key ? { ...item, serviceId: event.target.value } : item))}
                >
                  <option value="">Choose a service</option>
                  {line.serviceId && !validServices.has(line.serviceId) && <option value={line.serviceId} disabled>Service unavailable</option>}
                  {catalog.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.category} · {service.durationMin} min</option>)}
                </select>
                <NumberField
                  aria-label={`Price of service ${index + 1}`}
                  className="min-h-11"
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
          {serviceCatalog?.loading && <p role="status" className="text-sm text-muted-foreground">Loading services…</p>}
          {serviceCatalog?.loadMore && (
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={serviceCatalog.loadMore}>Load more services</Button>
          )}
          {!catalog.length && !serviceCatalog?.loading && <p className="text-sm text-muted-foreground">No services are available to test.</p>}
          <Button
            type="button"
            disabled={!catalog.length || services.length >= 50}
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => setServices((current) => [...current, { key: nextEditorKey(), serviceId: "", amount: "" }])}
          >
            <Plus aria-hidden className="size-4" />
            Add a service
          </Button>
          <FieldError id={`${id}-services-error`}>{submitted ? errors.services : ""}</FieldError>
        </fieldset>

        <Button type="submit" disabled={!code || running} className="w-full">
          {running ? <Spinner label="Running the quote" className="text-current" /> : null}
          Run quote
        </Button>
        {error?.identity === identity ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error.message}
          </p>
        ) : null}

        <div aria-live="polite" className="grid gap-3">
          {result && isStale(result) ? (
            <Callout tone="warning">
              Tested on {versionName(result)}. Run the quote again with the current inputs and rules.
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
    <span className={cn("ms-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-xs font-semibold", TONES.success.bg, TONES.success.border, TONES.success.text)}>
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
                {label}{checkIn ? ` from ${formatDay(checkIn)}` : ""}
              </span>
            </dt>
            <dd className="shrink-0 tabular-nums">{thb(result.subtotal)}</dd>
          </div>
          {checkIn ? <div className={cn("flex items-start justify-between gap-3 px-3 py-2", !directWins && "text-muted-foreground")}>
            <dt className="min-w-0">
              Direct-booking offer
              {directWins ? <AppliedTag /> : null}
            </dt>
            <dd className={cn("shrink-0 tabular-nums", directWins ? "font-semibold" : result.directDiscount ? "line-through" : "")}>
              {result.directDiscount ? `−${thb(result.directDiscount)}` : "—"}
            </dd>
          </div> : null}
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
