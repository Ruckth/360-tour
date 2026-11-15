import { v } from "convex/values";
export const inboxReasonValidator = v.union(
  v.literal("staff_reply"),
  v.literal("answering"),
  v.literal("handoff"),
  v.literal("sending"),
  v.literal("send_failed"),
  v.literal("follow_up"),
  v.literal("answered"),
  v.literal("awaiting_guest"),
  v.literal("needs_staff"),
  v.literal("no_reply_needed"),
  v.literal("archived"),
  v.literal("manual"),
  v.literal("review_required"),
);
export type InboxReason =
  | "staff_reply"
  | "answering"
  | "handoff"
  | "sending"
  | "send_failed"
  | "follow_up"
  | "answered"
  | "awaiting_guest"
  | "needs_staff"
  | "no_reply_needed"
  | "archived"
  | "manual"
  | "review_required";
