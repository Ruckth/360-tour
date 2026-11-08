"use client";

import {
  CalendarX,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  Plus,
  TicketPercent,
  TicketX,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { couponFix, type CouponPhase } from "@/lib/booking/coupon";
import { cn } from "@/lib/utils";
import { useCouponCopy } from "./coupon-copy";

export type CouponSource = "link" | "typed";

export type CouponNotice =
  | { kind: "removed"; code: string; source: CouponSource }
  /** bookings.create refused the code (e.g. its last use went meanwhile); the booking wasn't made. */
  | { kind: "ran_out"; code: string; detail: string };

/**
 * "Have a code?" on the review step: the entry, the attached code with its live preview
 * (applied, direct rate better, every problem), and what happened to a removed or refused code.
 * State lives in BookingFunnel; this only renders it.
 */
export function CouponField({
  code,
  source,
  phase,
  draft,
  open,
  entryError,
  notice,
  currency,
  disabled,
  onDraftChange,
  onOpenChange,
  onApply,
  onRemove,
  onUndo,
  onRetry,
  onAddNights,
  onChangeStay,
}: {
  /** The attached code, or null. */
  code: string | null;
  source: CouponSource;
  phase: CouponPhase;
  draft: string;
  open: boolean;
  /** "Enter a code" after an empty Apply; problems come from `phase`. */
  entryError: string | null;
  notice: CouponNotice | null;
  currency: string;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
  onRemove: () => void;
  onUndo: () => void;
  onRetry: () => void;
  /** Undefined when the extra nights aren't free (or not known yet). */
  onAddNights?: (nights: number) => void;
  onChangeStay: () => void;
}) {
  const t = useTranslations("Coupon");
  const copy = useCouponCopy(currency);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const wantsInputFocus = useRef(false);
  const rejected = phase.kind === "rejected";
  const attached = Boolean(code) && !rejected;
  const formOpen = !attached && (open || rejected);
  const errorText = rejected ? copy.problemText(phase.problem) : entryError;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (formOpen && wantsInputFocus.current) {
      wantsInputFocus.current = false;
      inputRef.current?.focus();
    }
  }, [formOpen]);

  // Remove hides its own button; keep the keyboard on the Undo that replaces it.
  useEffect(() => {
    if (notice?.kind === "removed") undoRef.current?.focus();
  }, [notice]);

  return (
    <section aria-label={t("label")} className="space-y-3">
      {attached && code ? (
        <AttachedCode code={code} source={source} phase={phase} onRemove={onRemove} disabled={disabled}>
          <PhaseMessage code={code} phase={phase} currency={currency} onRetry={onRetry} onAddNights={onAddNights} onChangeStay={onChangeStay} />
        </AttachedCode>
      ) : null}

      {!attached && !formOpen ? (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={`${id}-form`}
          onClick={() => {
            wantsInputFocus.current = true;
            onOpenChange(true);
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm font-semibold text-gold-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TicketPercent aria-hidden className="size-4" />
          {t("haveCode")}
        </button>
      ) : null}

      {formOpen ? (
        <div id={`${id}-form`} className="space-y-2">
          <Label htmlFor={`${id}-input`} className="text-sm font-semibold">
            {t("label")}
          </Label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <TicketPercent aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                id={`${id}-input`}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApply();
                  }
                }}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={40}
                placeholder={t("placeholder")}
                aria-invalid={errorText ? true : undefined}
                aria-describedby={errorText ? `${hintId} ${errorId}` : hintId}
                disabled={disabled}
                className="h-12 rounded-xl pl-10 text-base font-semibold tracking-[0.06em] placeholder:font-medium placeholder:tracking-normal aria-[invalid=true]:border-destructive md:h-11 md:text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onApply}
              disabled={disabled || phase.kind === "checking"}
              className="h-12 shrink-0 rounded-xl px-5 md:h-11"
            >
              {phase.kind === "checking" ? <Spinner label={t("checking")} className="text-current" /> : null}
              {phase.kind === "checking" ? t("checking") : t("apply")}
            </Button>
          </div>
          <p id={hintId} className="text-xs leading-5 text-muted-foreground">
            {t("hint")}
          </p>
          <div id={errorId} aria-live="polite">
            {errorText ? (
              <>
                <p className="flex items-start gap-1.5 text-xs font-medium leading-5 text-destructive">
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0">{errorText}</span>
                </p>
                {rejected ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("directStillApplies")}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div aria-live="polite">
        {notice?.kind === "removed" ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm text-foreground">
            <span className="min-w-0">{t("removedNotice")}</span>
            <button
              ref={undoRef}
              type="button"
              onClick={onUndo}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md font-semibold text-gold-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Undo2 aria-hidden className="size-4" />
              {t("undo")}
            </button>
          </div>
        ) : notice?.kind === "ran_out" ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
            <TicketX aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{t("ranOutTitle", { code: notice.code })}</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                {notice.detail ? `${notice.detail}. ` : ""}
                {t("ranOutBody")}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Pill({ tone, icon, children }: { tone: "gold" | "muted"; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "gold" ? "bg-gold/15 text-gold-text" : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function AttachedCode({
  code,
  source,
  phase,
  disabled,
  onRemove,
  children,
}: {
  code: string;
  source: CouponSource;
  phase: CouponPhase;
  disabled?: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("Coupon");
  const applied = phase.kind === "applied";
  const pill =
    phase.kind === "applied" ? (
      <Pill tone="gold" icon={<Check aria-hidden className="size-3" />}>{t("applied")}</Pill>
    ) : phase.kind === "checking" ? (
      <Pill tone="muted" icon={<Spinner label={t("checking")} className="size-3 text-current" />}>{t("checking")}</Pill>
    ) : phase.kind === "pending" ? (
      <Pill tone="muted" icon={<Clock aria-hidden className="size-3" />}>{t("chooseDatesPill")}</Pill>
    ) : (
      <Pill tone="muted" icon={<Info aria-hidden className="size-3" />}>{t("notUsed")}</Pill>
    );
  return (
    <div
      data-testid="coupon-attached"
      className={cn("overflow-hidden rounded-xl border", applied ? "border-gold/40 bg-gold/5" : "border-border bg-card")}
    >
      <div className="flex items-center gap-3 p-3">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-text">
          <TicketPercent className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="break-all text-sm font-bold tracking-[0.06em] text-foreground">{code}</p>
            {pill}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{source === "link" ? t("fromLink") : t("enteredByYou")}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t("removeCode", { code })}
          className="h-10 shrink-0 px-3 text-muted-foreground hover:text-foreground"
        >
          {t("remove")}
        </Button>
      </div>
      <div aria-live="polite" className={cn("border-t px-3 py-3 text-sm", applied ? "border-gold/25" : "border-border")}>
        {children}
      </div>
    </div>
  );
}

function Row({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{title}</p>
        {body ? <p className="mt-0.5 leading-relaxed text-muted-foreground">{body}</p> : null}
        {action ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

function PhaseMessage({
  code,
  phase,
  currency,
  onRetry,
  onAddNights,
  onChangeStay,
}: {
  code: string;
  phase: CouponPhase;
  currency: string;
  onRetry: () => void;
  onAddNights?: (nights: number) => void;
  onChangeStay: () => void;
}) {
  const t = useTranslations("Coupon");
  const copy = useCouponCopy(currency);
  const iconClass = "mt-0.5 size-4 shrink-0";
  switch (phase.kind) {
    case "applied": {
      const { result } = phase;
      const body = [result.directDiscount > 0 ? t("appliedBody") : "", result.capped ? t("appliedCapped") : ""].filter(Boolean).join(" ");
      return (
        <Row
          icon={<CircleCheck aria-hidden className={cn(iconClass, "text-gold-text")} />}
          title={t("appliedTitle", { code, amount: copy.format.money(result.couponDiscount) })}
          body={body || undefined}
        />
      );
    }
    case "worse":
      return (
        <Row
          icon={<Info aria-hidden className={cn(iconClass, "text-muted-foreground")} />}
          title={t("worseTitle")}
          body={t("worseBody", {
            code,
            coupon: copy.format.money(phase.result.couponDiscount),
            direct: copy.format.money(phase.result.directDiscount),
          })}
        />
      );
    case "not_used": {
      const fix = couponFix(phase.problem);
      const action =
        fix?.kind === "add_nights" && onAddNights ? (
          <Button type="button" size="sm" className="h-10" onClick={() => onAddNights(fix.nights)}>
            <Plus aria-hidden className="size-4" />
            {fix.nights === 1 ? t("addNight") : t("addNights", { count: fix.nights })}
          </Button>
        ) : fix?.kind === "change_dates" || fix?.kind === "change_villa" ? (
          <Button type="button" size="sm" variant="outline" className="h-10" onClick={onChangeStay}>
            {fix.kind === "change_dates" ? t("changeDates") : t("changeVilla")}
          </Button>
        ) : null;
      const Icon = phase.problem.code === "stay_outside_dates" ? CalendarX : Info;
      return (
        <Row
          icon={<Icon aria-hidden className={cn(iconClass, "text-muted-foreground")} />}
          title={copy.problemText(phase.problem)}
          body={phase.result.directDiscount > 0 ? t("directStillApplies") : undefined}
          action={action}
        />
      );
    }
    case "pending":
      return <Row icon={<Clock aria-hidden className={cn(iconClass, "text-muted-foreground")} />} title={t("chooseDates")} />;
    case "checking":
      return <Row icon={<Spinner label={t("checking")} className={cn(iconClass, "text-muted-foreground")} />} title={t("summaryChecking", { code })} />;
    case "error":
      return (
        <Row
          icon={<CircleAlert aria-hidden className={cn(iconClass, "text-muted-foreground")} />}
          title={t("checkFailed")}
          action={
            <Button type="button" size="sm" variant="outline" className="h-10" onClick={onRetry}>
              {t("tryAgain")}
            </Button>
          }
        />
      );
    default:
      return null;
  }
}
