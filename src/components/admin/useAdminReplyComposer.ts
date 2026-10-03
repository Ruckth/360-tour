"use client";

import { useAuth } from "@clerk/nextjs";
import type { Id } from "convex/_generated/dataModel";
import { useRef, useState } from "react";
import { sourceLabel } from "@/components/admin/labels";

type SessionId = Id<"chatSessions">;
type ReplyEntry = { draft: string; pending?: boolean; error?: string; status?: string };

export type AdminReplyComposer = {
  draft: string;
  pending: boolean;
  error: string | null;
  status: string | null;
  setDraft: (value: string) => void;
  /**
   * Sends the current draft for this session. `onSent` runs only after a successful reply; capture any
   * navigation guard in it at call time, because the inbox may have moved on while the reply was in flight.
   */
  send: (onSent?: (sessionId: SessionId) => void) => Promise<void>;
};

/** Staff reply composer, kept per conversation so a slow reply in one chat never blocks or clears another. */
export function useAdminReplyComposer(sessionId: SessionId | null): AdminReplyComposer {
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<Partial<Record<SessionId, ReplyEntry>>>({});
  // State lags a render behind; this guards a double submit before React commits `pending`.
  const pendingSessions = useRef(new Set<SessionId>());
  const entry = sessionId ? entries[sessionId] : undefined;

  function update(id: SessionId, patch: (current: ReplyEntry) => ReplyEntry) {
    setEntries((current) => ({ ...current, [id]: patch(current[id] ?? { draft: "" }) }));
  }

  async function send(onSent?: (sessionId: SessionId) => void) {
    const id = sessionId;
    const content = entry?.draft.trim() ?? "";
    if (!id || !content || pendingSessions.current.has(id)) return;
    pendingSessions.current.add(id);
    update(id, ({ draft }) => ({ draft, pending: true }));
    let sent = false;
    try {
      const token = await getToken({ template: "convex" });
      if (!token) throw new Error("Admin sign-in has expired. Sign in again.");
      const response = await fetch("/api/admin/chat/reply", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId: id,
          requestId: crypto.randomUUID(),
          content,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        channel?: string;
      };
      if (!response.ok) throw new Error(result.error || "Unable to send reply");
      update(id, ({ draft }) => ({
        // Keep anything typed while the reply was in flight.
        draft: draft.trim() === content ? "" : draft,
        status:
          result.channel === "web"
            ? "Reply sent"
            : `Reply accepted by ${sourceLabel(result.channel)}. Delivery is not confirmed.`,
      }));
      sent = true;
    } catch (error) {
      update(id, ({ draft }) => ({
        draft,
        error: error instanceof Error ? error.message : "Unable to send reply",
      }));
    } finally {
      pendingSessions.current.delete(id);
      update(id, (current) => ({ ...current, pending: false }));
    }
    // Outside the try: a navigation problem is not a failed reply.
    if (sent) onSent?.(id);
  }

  return {
    draft: entry?.draft ?? "",
    pending: entry?.pending ?? false,
    error: entry?.error ?? null,
    status: entry?.status ?? null,
    setDraft: (value) => {
      if (sessionId) update(sessionId, (current) => ({ ...current, draft: value }));
    },
    send,
  };
}
