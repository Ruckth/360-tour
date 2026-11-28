"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAdminNav } from "./staff-access";

type WaitingCount = FunctionReturnType<typeof api.messaging.adminChat.waitingCount>;
export type WaitingBadge = { text: string; label: string };

/** "3" / "99+" and a spoken "3 chats need you"; null while loading, unavailable, or at zero. */
export function waitingBadge(result: WaitingCount | undefined | unknown): WaitingBadge | null {
  if (!result || typeof result !== "object" || typeof (result as { count?: unknown }).count !== "number") return null;
  const { count, capped } = result as NonNullable<WaitingCount>;
  if (count === 0) return null;
  const text = capped ? `${count}+` : String(count);
  return { text, label: `${text} ${count === 1 && !capped ? "chat needs" : "chats need"} you` };
}

/**
 * The Needs you badge for the Chats link. Only people whose navigation includes Chats subscribe;
 * the server checks the same operations access as the queue. Navigation never waits for it.
 */
export function useWaitingChatsBadge(): WaitingBadge | null {
  const canOpenChats = useAdminNav().some((item) => item.href === "/admin/chats");
  return waitingBadge(useQuery(api.messaging.adminChat.waitingCount, canOpenChats ? {} : "skip"));
}
