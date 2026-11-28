import { sourceLabel } from "@/components/admin/labels";
import { statusMeta } from "@/components/admin/status-tones";
import { formatDateTime } from "@/components/admin/admin-chat-format";
import type { AdminSessionStatus, SessionChannelFilter } from "@/components/admin/admin-chat-types";

export type SessionStatus = "needs_reply" | "in_progress" | "active" | "all" | "inactive";
export type EmptyChatFilter = "non_empty" | "empty";

export const statusTabs = [
  { value: "active", label: "Live" },
  { value: "all", label: "All" },
  { value: "inactive", label: "Inactive" },
] satisfies { value: SessionStatus; label: string }[];
export const statusOptions: SessionStatus[] = ["needs_reply", "in_progress", "active", "all", "inactive"];
export type InboxStateFilter = AdminSessionStatus | "done";
export type InboxQueue = "waiting" | "open" | "done";
export const queueTabs = [
  { value: "waiting", label: "Needs you" },
  { value: "open", label: "In progress" },
  { value: "done", label: "Done" },
] satisfies { value: InboxQueue; label: string }[];
export function queueParams(queue: InboxQueue): { view: SessionStatus; state: InboxStateFilter } {
  return { view: queue === "waiting" ? "needs_reply" : queue === "open" ? "in_progress" : "all", state: queue === "done" ? "done" : "open" };
}
export const adminStatusOptions: InboxStateFilter[] = ["open", "done", "resolved", "archived"];
export const adminStatusTabs = adminStatusOptions.map((value) => ({
  value,
  label: value === "done" ? "All done" : statusMeta("chatSession", value).label,
}));
export const emptyFilterOptions = ["non_empty", "empty"] satisfies EmptyChatFilter[];
export const channelFilterOptions = [
  "all",
  "web",
  "line",
  "facebook",
  "whatsapp",
  "instagram",
] satisfies SessionChannelFilter[];
// URL param defaults; a param equal to its default is left out of the URL.
export const FILTER_DEFAULTS = {
  view: "needs_reply",
  state: "open",
  empty: "non_empty",
  channel: "all",
  q: "",
  from: "",
  to: "",
} as const;
export type FilterParam = keyof typeof FILTER_DEFAULTS;

export function readOption<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}
export function dateTimeInputToMillis(value: string, boundary: "start" | "end" = "start") {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  return boundary === "end" ? timestamp + 59_999 : timestamp;
}

export function dateTimeBadgeLabel(value: string) {
  const timestamp = dateTimeInputToMillis(value);
  return typeof timestamp === "number" ? formatDateTime(timestamp) : value;
}

export function emptyFilterLabel(value: EmptyChatFilter) {
  if (value === "empty") return "Without messages";
  return "Not empty";
}

export function channelFilterLabel(channel: SessionChannelFilter) {
  return channel === "all" ? "All" : sourceLabel(channel);
}
