"use client";

import { Check, CircleAlert, CircleCheck, Copy, Info, MoreHorizontal, TicketPercent, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TONES } from "../status-tones";

// Small building blocks shared by the marketing screens.

let keySeq = 0;
/** A fresh key for remounting an editor with new starting values. */
export const nextEditorKey = () => ++keySeq;

/** "/f1" in a mono chip, the link's identity in lists. */
export function SlugChip({ path, large = false }: { path: string; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 px-2 font-mono font-semibold text-foreground",
        large ? "h-10 min-w-12 text-sm" : "h-8 min-w-11 text-xs",
      )}
    >
      {path}
    </span>
  );
}

/** Coupon code chip: gold while the offer is live, grey when it isn't. */
export function CouponChip({ code, dim = false }: { code: string; dim?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-xs font-semibold",
        dim ? "border-border bg-muted text-muted-foreground" : "border-gold/40 bg-gold/10 text-gold-text",
      )}
    >
      <TicketPercent aria-hidden className="size-3.5 shrink-0" />
      {code}
    </span>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copies a link and confirms it in place (icon swaps to a tick, screen readers hear "Copied"). */
export function CopyButton({
  text,
  label,
  showLabel = false,
  className,
  variant = "ghost",
  size,
}: {
  text: string;
  /** Accessible name, e.g. "Copy book.auralis.example/f1". */
  label: string;
  showLabel?: boolean;
  className?: string;
  variant?: "ghost" | "outline";
  size?: "sm" | "default" | "icon";
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  }

  const Icon = state === "copied" ? Check : Copy;
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size ?? (showLabel ? "default" : "icon")}
        aria-label={showLabel ? undefined : label}
        title={showLabel ? undefined : label}
        onClick={() => void copy()}
        className={cn(!showLabel && "text-muted-foreground hover:text-foreground", className)}
      >
        <Icon aria-hidden className="size-4" />
        {showLabel ? (state === "copied" ? "Copied" : "Copy") : null}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Link copied" : state === "failed" ? "Couldn’t copy. Select the link and copy it by hand." : ""}
      </span>
    </>
  );
}

type CalloutTone = "info" | "warning" | "success" | "danger";
const CALLOUT_ICONS: Record<CalloutTone, LucideIcon> = { info: Info, warning: TriangleAlert, success: CircleCheck, danger: CircleAlert };

/** Inline message box with an icon, in the status tones. */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const Icon = CALLOUT_ICONS[tone];
  const tones = tone === "info" ? null : TONES[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm",
        tones ? cn(tones.bg, tones.border) : "border-border bg-muted/50",
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tones ? tones.text : "text-muted-foreground")} />
      <div className="min-w-0 flex-1 basis-48">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className={cn(title ? "text-muted-foreground" : "text-foreground")}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export type Notice = { tone: "success" | "danger"; text: string };

/** One-line result of the last action ("Link paused"), cleared after a few seconds. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((text: string, tone: Notice["tone"] = "success") => {
    setNotice({ text, tone });
    window.clearTimeout(timer.current);
    if (tone === "success") timer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  return { notice, show, clear: () => setNotice(null) };
}

export function NoticeBar({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  return (
    <div aria-live="polite" className={notice ? undefined : "sr-only"}>
      {notice ? (
        <div
          role={notice.tone === "danger" ? "alert" : "status"}
          className={cn(
            "flex items-center gap-2 border-b px-4 py-2.5 text-sm",
            notice.tone === "danger" ? "border-border font-medium text-destructive" : cn(TONES.success.bg, TONES.success.border, TONES.success.text),
          )}
        >
          {notice.tone === "danger" ? <CircleAlert aria-hidden className="size-4 shrink-0" /> : <CircleCheck aria-hidden className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1">{notice.text}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="-my-1 h-8">
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {children}
    </p>
  );
}

export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Whole-number field with an optional "฿" prefix or "%" suffix. Value is the raw text. */
export function NumberField({
  prefix,
  suffix,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { prefix?: string; suffix?: string }) {
  return (
    <div className="relative">
      {prefix ? (
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <Input inputMode="numeric" autoComplete="off" className={cn("tabular-nums", prefix && "pl-7", suffix && "pr-9", className)} {...props} />
      {suffix ? (
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export { parseWhole } from "./coupon-form";

export const wholeText = (value?: number) => (value === undefined ? "" : value.toLocaleString("en-US"));

/** Usage against a limit; amber from 80 %, red when used up. */
export function UsageBar({ used, limit, label }: { used: number; limit?: number; label: string }) {
  if (!limit) return null;
  const ratio = Math.min(1, used / limit);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      className="h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full", ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-primary")}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export type RowAction = { label: string; icon: LucideIcon; onSelect: () => void; destructive?: boolean; disabled?: boolean };

/** "More actions" popover for a list row. */
export function RowMenu({ label, actions, className }: { label: string; actions: RowAction[]; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} className={cn("text-muted-foreground hover:text-foreground", className)}>
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <ul className="grid">
          {actions.map(({ label: text, icon: Icon, onSelect, destructive, disabled }) => (
            <li key={text}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                }}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9",
                  destructive ? "text-destructive" : "text-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-4 shrink-0", destructive ? "text-destructive" : "text-muted-foreground")} />
                {text}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Radio cards / segmented choice built on native radios, so arrow keys and labels work. */
export function ChoiceGroup<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  columns = "sm:grid-cols-2",
  describedBy,
}: {
  name: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  columns?: string;
  describedBy?: string;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2" aria-describedby={describedBy}>
      <legend className="mb-2 text-sm font-medium leading-none text-foreground">{label}</legend>
      <div className={cn("grid gap-2", columns)}>
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm transition hover:bg-muted has-[:checked]:border-foreground/50 has-[:checked]:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="size-4 shrink-0 accent-foreground focus-visible:outline-none"
              />
              {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{option.label}</span>
                {option.hint ? <span className="block text-xs text-muted-foreground">{option.hint}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Label/value rows for summaries and previews. */
export function FactList({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid gap-2 text-sm", className)}>
      {rows.map(([term, detail], index) => (
        <div key={index} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words text-foreground">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
