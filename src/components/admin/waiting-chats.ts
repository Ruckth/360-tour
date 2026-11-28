"use client";

import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useQueries } from "convex/react";
import { useAdminNav } from "./staff-access";

export type WaitingBadge = { text: string; label: string };

/** "3" / "99+" and a spoken "3 chats need you"; null while loading, unavailable, or at zero. */
export function waitingBadge(waiting: number | null | undefined): WaitingBadge | null {
  if (typeof waiting !== "number" || waiting <= 0) return null;
  const text = waiting > 99 ? "99+" : String(waiting);
  return { text, label: `${text} ${waiting === 1 ? "chat needs" : "chats need"} you` };
}

/** Preserve the common Convex subscription while isolating a failed count from its host view. */
export function useSafeQueueCounts(enabled = true) {
  const query = api.messaging.adminChat.queueCounts;
  const { queue } = useQueries(enabled ? { queue: { query, args: {} } } : {}) as {
    queue?: FunctionReturnType<typeof query> | Error;
  };
  return queue instanceof Error ? null : queue;
}

/** Subscribe only when the staff member can open Chats. */
export function useWaitingChatsBadge(): WaitingBadge | null {
  const canOpenChats = useAdminNav().some((item) => item.href === "/admin/chats");
  return waitingBadge(useSafeQueueCounts(canOpenChats)?.waiting);
}
