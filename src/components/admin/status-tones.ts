import { STATUS_LABELS, type StatusDomain, type StatusKey } from "./labels";

/**
 * One status colour system for the whole admin.
 *
 * Each tone is a tinted background with 700-level text (300-level in dark mode), so every
 * badge passes WCAG AA on cards in both themes; tests/unit/admin-contrast.test.ts checks it.
 * Colour is never the only signal: always render the label too (see StatusBadge).
 *
 * Meaning of each tone:
 *   neutral  scheduled, nothing to do yet     info     confirmed / in progress
 *   success  done or paid                     warning  waiting on someone (pending, unpaid, needs reply)
 *   danger   failed or missed                 muted    ended or switched off (cancelled, archived)
 *   accent   outside our control or special   (OTA blocks, AI paused, guest arrived)
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted" | "accent";

export type ToneClasses = { bg: string; text: string; border: string; dot: string };

// Full class literals so Tailwind can find them.
export const TONES: Record<Tone, ToneClasses> = {
  neutral: {
    bg: "bg-slate-100 dark:bg-slate-400/15",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-400/30",
    dot: "bg-slate-500 dark:bg-slate-400",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-400/15",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-400/30",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-400/15",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-400/30",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-400/15",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-400/30",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  danger: {
    bg: "bg-red-50 dark:bg-red-400/15",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-200 dark:border-red-400/30",
    dot: "bg-red-500 dark:bg-red-400",
  },
  muted: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
    dot: "bg-zinc-400",
  },
  accent: {
    bg: "bg-violet-50 dark:bg-violet-400/15",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-200 dark:border-violet-400/30",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
};

/**
 * Event-chip colour per tone, for the calendars (`event.color`). The chip tints this at
 * 15–30 % behind foreground text, so it stays readable; same hues as the badges.
 */
export const CALENDAR_TONE_COLORS: Record<Tone, string> = {
  neutral: "var(--color-slate-500)",
  info: "var(--color-blue-500)",
  success: "var(--color-emerald-500)",
  warning: "var(--color-amber-500)",
  danger: "var(--color-red-500)",
  muted: "var(--color-zinc-400)",
  accent: "var(--color-violet-500)",
};

/**
 * Tone for every status. Rules: the same meaning gets the same tone in every domain
 * (pending and unpaid are both warning; cancelled is always muted), and opposite meanings
 * never share a hue (cancelled is muted, blocked dates are neutral or accent).
 */
export const STATUS_TONES: { [D in StatusDomain]: Record<StatusKey<D>, Tone> } = {
  hotelBooking: {
    pending: "warning",
    confirmed: "info",
    paid: "success",
    completed: "success",
    cancelled: "muted",
    hostBlock: "neutral",
    otaBlock: "accent",
  },
  appointment: {
    booked: "neutral",
    arrived: "accent",
    in_service: "info",
    completed: "success",
    unpaid: "warning",
    no_show: "danger",
    cancelled: "muted",
  },
  payment: {
    unpaid: "warning",
    pending: "warning",
    paid: "success",
    refunded: "neutral",
    failed: "danger",
  },
  chatSession: {
    open: "info",
    needs_reply: "warning",
    resolved: "success",
    archived: "muted",
    ai_paused: "accent",
  },
  answer: {
    draft: "neutral",
    approved: "success",
    archived: "muted",
  },
  businessFact: {
    draft: "neutral",
    approved: "success",
    archived: "muted",
  },
  unknownQuestion: {
    new: "warning",
    resolved: "success",
    ignored: "muted",
  },
  channelHealth: {
    ok: "success",
    warning: "warning",
    failing: "danger",
    not_configured: "muted",
  },
};

export type StatusMeta = { label: string; tone: Tone };

/** Label and tone for a status, e.g. `statusMeta("appointment", "no_show")`. */
export function statusMeta<D extends StatusDomain>(domain: D, key: StatusKey<D>): StatusMeta {
  return {
    label: (STATUS_LABELS[domain] as Record<StatusKey<D>, string>)[key],
    tone: STATUS_TONES[domain][key],
  };
}
