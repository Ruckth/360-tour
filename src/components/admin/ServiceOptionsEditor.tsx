"use client";

import { satangToBaht } from "convex/shared/money";
import type { Doc } from "convex/_generated/dataModel";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { currencySymbol, formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseMoneyInput } from "@/lib/money-input";
import { serviceOptions, suggestedPrice, type ServiceOption } from "@/lib/service-options";

const PRESETS = [30, 45, 60, 75, 90, 120, 150, 180];
export const MAX_OPTIONS = 6;
const DAY_MIN = 1440;

type Row = { key: number; duration: string; price: string; savedDuration?: number };
type Problem = { field: "duration" | "price"; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function rowOption(row: Row): ServiceOption {
  return { durationMin: row.duration.trim() ? Number(row.duration) : NaN, price: parseMoneyInput(row.price) };
}

/** Each row's first problem, in the order staff fix them: length, repeat, day limit, then price. */
export function optionProblems(rows: readonly Row[], bufferMin: number) {
  const problems = new Map<number, Problem>();
  const seen = new Set<number>();
  for (const row of rows) {
    const { durationMin, price } = rowOption(row);
    const problem: Problem | null =
      !Number.isInteger(durationMin) || durationMin <= 0 || durationMin % 15
        ? { field: "duration", message: "Duration must be a multiple of 15 minutes" }
        : seen.has(durationMin)
          ? { field: "duration", message: `${durationMin} min is already listed` }
          : durationMin + (Number.isFinite(bufferMin) ? bufferMin : 0) > DAY_MIN
            ? { field: "duration", message: "Duration plus turnaround must fit in one day" }
            : !row.price.trim()
              ? { field: "price", message: "Enter a price (0 or more)" }
              : !Number.isFinite(price)
                ? { field: "price", message: "Enter a price with at most 2 decimals." }
                : null;
    if (Number.isFinite(durationMin)) seen.add(durationMin);
    if (problem) problems.set(row.key, problem);
  }
  return problems;
}

type Saved = Pick<Doc<"services">, "durationMin" | "price" | "options">;

function savedRows(service?: Saved): Row[] {
  return service
    ? serviceOptions(service).map((option, key) => ({
        key, duration: String(option.durationMin), price: String(satangToBaht(option.price)), savedDuration: option.durationMin,
      }))
    : [{ key: 0, duration: "60", price: "" }];
}
const savedDefault = (rows: readonly Row[], service?: Saved) => rows.find((row) => row.savedDuration === service?.durationMin)?.key ?? rows[0].key;

/** The editor's rows and default; `payload` is null (and errors show) until every row is valid. */
export function useServiceOptions(service?: Saved) {
  const [rows, setRows] = useState<Row[]>(() => savedRows(service));
  // null after the default length is removed while several remain: staff pick the replacement deliberately.
  const [defaultKey, setDefaultKey] = useState<number | null>(() => savedDefault(rows, service));
  const [checked, setChecked] = useState(false);
  return {
    rows, defaultKey, setDefaultKey, checked,
    /** Shows each row's problem, e.g. when the browser finds an invalid field on submit. */
    reveal: () => setChecked(true),
    /** Whether the lengths, prices and default are still exactly this saved version's. */
    matches(saved: Saved) {
      const options = serviceOptions(saved);
      const current = rows.map(rowOption).sort((a, b) => a.durationMin - b.durationMin);
      return current.length === options.length
        && current.every((option, index) => option.durationMin === options[index].durationMin && option.price === options[index].price)
        && Number(rows.find((row) => row.key === defaultKey)?.duration) === saved.durationMin;
    },
    /** Replaces the rows and default with this saved version's. */
    load(saved: Saved) {
      const next = savedRows(saved);
      setRows(next);
      setDefaultKey(savedDefault(next, saved));
    },
    update: (key: number, field: "duration" | "price", value: string) =>
      setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row))),
    /** Adds a length in order by duration, priced at the per-minute rate; returns its key. */
    add(durationMin: number) {
      const key = Math.max(...rows.map((row) => row.key)) + 1;
      const price = suggestedPrice(rows.map(rowOption), durationMin);
      const row = { key, duration: String(durationMin), price: price ? String(satangToBaht(price)) : "" };
      const at = rows.findIndex((other) => !(Number(other.duration) < durationMin));
      flushSync(() => setRows(at < 0 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)]));
      return key;
    },
    remove(key: number) {
      const next = rows.filter((row) => row.key !== key);
      flushSync(() => {
        setRows(next);
        if (key === defaultKey) setDefaultKey(next.length === 1 ? next[0].key : null);
      });
      return next;
    },
    /** Validated options and default for the save, or null after showing the problems. */
    payload(bufferMin: number) {
      flushSync(() => setChecked(true));
      if (optionProblems(rows, bufferMin).size || defaultKey === null) return null;
      const options = rows.map(rowOption).sort((a, b) => a.durationMin - b.durationMin);
      return { options, defaultDurationMin: Number(rows.find((row) => row.key === defaultKey)!.duration) };
    },
  };
}

/** "Durations & prices": one row per length (minutes, price, default, remove), quick-add lengths below. */
export function ServiceOptionsEditor({
  state,
  bufferMin,
  currency,
  serviceName,
  usage,
}: {
  state: ReturnType<typeof useServiceOptions>;
  bufferMin: number;
  currency: string;
  serviceName: string;
  /** Upcoming booked or arrived appointments per saved length. */
  usage?: readonly { durationMin: number; count: number }[];
}) {
  const { rows, defaultKey, setDefaultKey } = state;
  const symbol = currencySymbol(currency);
  const list = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const problems = state.checked ? optionProblems(rows, bufferMin) : new Map<number, Problem>();
  const used = new Set(rows.map((row) => Number(row.duration)));
  const presets = PRESETS.filter((minutes) => !used.has(minutes));
  const full = rows.length >= MAX_OPTIONS;
  const upcoming = (row: Row) => usage?.find((entry) => entry.durationMin === row.savedDuration)?.count ?? 0;
  const field = (key: number, name: "duration" | "price") => list.current?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-field="${name}"]`);
  const defaultDuration = Number(rows.find((row) => row.key === defaultKey)?.duration);
  const guestsSee = rows
    .map(rowOption)
    .filter((option) => option.durationMin > 0 && option.price >= 0)
    .sort((a, b) => a.durationMin - b.durationMin)
    .map((option) => `${option.durationMin} min ${formatMoney(option.price, currency)}${option.durationMin === defaultDuration ? " (default)" : ""}`);

  function add(durationMin?: number) {
    const minutes = durationMin ?? (() => {
      let next = Math.max(0, ...[...used].filter(Number.isFinite)) + 15;
      while (used.has(next)) next += 15;
      return next;
    })();
    const key = state.add(minutes);
    // A preset's length is set, so the price is next; "Other…" starts on the length.
    const next = field(key, durationMin === undefined ? "duration" : "price");
    next?.focus();
    next?.select();
  }

  function remove(row: Row, index: number) {
    const next = state.remove(row.key);
    const count = upcoming(row);
    const removedDefault = row.key === defaultKey;
    const newDefault = removedDefault && next.length === 1 ? next[0] : undefined;
    setAnnouncement([
      `Removed ${row.duration} min.`,
      newDefault ? `${newDefault.duration.trim() ? `${newDefault.duration} min` : "The remaining length"} is now the default.` : "",
      removedDefault && !newDefault ? "Choose a new default length." : "",
      count ? `${plural(count, "upcoming booking keeps its", "upcoming bookings keep their")} time and price.` : "",
    ].filter(Boolean).join(" "));
    const neighbour = next[Math.max(0, index - 1)];
    field(neighbour.key, "duration")?.focus();
  }

  // The browser's own check (e.g. 119 against step 15) would show its bubble and block the save
  // with the row's message blank; show the row's own message and focus instead.
  function showOwnError(event: FormEvent<HTMLInputElement>) {
    event.preventDefault();
    const input = event.currentTarget;
    flushSync(state.reveal);
    // The browser reports the first invalid field; when that is an earlier one, it keeps focus.
    const first = [...(input.form?.elements ?? [])].find((element) => (element as HTMLInputElement).validity?.valid === false);
    if (!first || first === input) input.focus();
  }

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-sm font-medium">
        Durations &amp; prices
        <span className="text-xs font-normal text-muted-foreground">Up to {MAX_OPTIONS}</span>
      </legend>
      <div ref={list} className="grid gap-2">
        <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_2.25rem] gap-2 text-xs text-muted-foreground">
          <span>Duration</span>
          <span>Price</span>
          <span className="text-center">Default</span>
        </div>
        {rows.map((row, index) => {
          const problem = problems.get(row.key);
          const errorId = `sv-option-${row.key}-error`;
          const noteId = `sv-option-${row.key}-note`;
          const count = upcoming(row);
          const describedBy = problem ? errorId : count ? noteId : undefined;
          const label = row.duration.trim() ? `${row.duration} min` : `length ${index + 1}`;
          return (
            <div key={row.key} className="grid gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_2.25rem] items-center gap-2">
                <div className="relative">
                  <Input
                    data-row={row.key}
                    data-field="duration"
                    type="number"
                    inputMode="numeric"
                    min={15}
                    step={15}
                    value={row.duration}
                    aria-label={`Duration ${index + 1} (minutes)`}
                    aria-invalid={problem?.field === "duration" || undefined}
                    aria-describedby={describedBy}
                    onChange={(event) => state.update(row.key, "duration", event.target.value)}
                    onInvalid={showOwnError}
                    className="pr-11 tabular-nums"
                  />
                  <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">min</span>
                </div>
                <div className="relative">
                  <Input
                    data-row={row.key}
                    data-field="price"
                    type="text"
                    inputMode="decimal"
                    value={row.price}
                    aria-label={`Price for ${label} (${currency})`}
                    aria-invalid={problem?.field === "price" || undefined}
                    aria-describedby={describedBy}
                    onChange={(event) => state.update(row.key, "price", event.target.value)}
                    className={cn("pr-2 tabular-nums", symbol.length > 1 ? "pl-12" : "pl-7")}
                  />
                  <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
                </div>
                <label className="flex min-h-10 cursor-pointer items-center justify-center">
                  <input
                    type="radio"
                    name="sv-default"
                    className="size-4 accent-foreground"
                    checked={row.key === defaultKey}
                    aria-invalid={defaultKey === null || undefined}
                    onChange={() => setDefaultKey(row.key)}
                    aria-label={`Default length: ${label}`}
                  />
                </label>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  disabled={rows.length === 1}
                  aria-label={`Remove ${label}`}
                  onClick={() => remove(row, index)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
              {problem ? (
                <p id={errorId} className="text-xs text-destructive">{problem.message}</p>
              ) : count ? (
                <p id={noteId} className="text-xs text-muted-foreground">
                  {plural(count, "upcoming booking uses", "upcoming bookings use")} this length. Changing it won&apos;t move {count === 1 ? "it" : "them"}.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {defaultKey === null ? (
        <p role="alert" className="text-xs text-destructive">You removed the default length. Choose which remaining length guests get by default.</p>
      ) : null}
      <div role="group" aria-label="Add a length" className="flex flex-wrap gap-1.5 pt-1">
        {full ? (
          <p className="text-xs text-muted-foreground">Maximum of {MAX_OPTIONS} lengths</p>
        ) : (
          <>
            {presets.map((minutes) => (
              <Button key={minutes} type="button" size="sm" variant="outline" className="h-8 rounded-full px-3 tabular-nums" onClick={() => add(minutes)}>
                <Plus aria-hidden className="size-3.5" />
                {minutes} min
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full px-3" onClick={() => add()}>
              Other…
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Guests see:</span> {serviceName.trim() || "New service"} —{" "}
        {guestsSee.length ? guestsSee.join(" · ") : "add a duration"}
      </p>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </fieldset>
  );
}
