"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import type { ChannelConfigStatus } from "@/lib/admin/channel-config";
import { errorText } from "@/lib/staff-bookings";

export type ChannelConfig =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; channels: ChannelConfigStatus };

/** Which channel env vars are set on the website (Vercel) deployment, via /api/admin/config-status. */
export function useChannelConfig(): ChannelConfig {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<ChannelConfig>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken({ template: "convex" });
        const response = await fetch("/api/admin/config-status", {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as { channels?: ChannelConfigStatus; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.channels) {
          setStatus({ state: "error", message: body.error ?? `Request failed (${response.status})` });
        } else {
          setStatus({ state: "ready", channels: body.channels });
        }
      } catch (err) {
        if (!cancelled) setStatus({ state: "error", message: errorText(err, "Could not check the website configuration.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return status;
}
