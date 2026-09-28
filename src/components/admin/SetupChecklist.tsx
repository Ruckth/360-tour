"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { CheckCircle2, Circle, Copy, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CHANNEL_WEBHOOK_PATH, type ChannelKey } from "@/lib/admin/channel-config";
import { errorText } from "@/lib/staff-bookings";
import { useStoredState } from "@/lib/use-stored-state";
import { cn } from "@/lib/utils";
import { sourceLabel } from "./labels";
import { TONES } from "./status-tones";
import { useChannelConfig } from "./useChannelConfig";

type Item = {
  id: string;
  label: string;
  done: boolean;
  /** What to do when not done (or extra context when done). */
  detail?: string;
  href: string;
  linkLabel: string;
  copy?: { label: string; value: string };
  testEmail?: boolean;
};

const CONVEX_SITE =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL || process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.convex\.cloud$/, ".convex.site");

/** Browser origin after mount (undefined during SSR, so the first render matches the server). */
function useOrigin() {
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** Setup items computed from existing data: Convex env and records, plus the website's channel env vars. */
export function useSetupChecklist(): { items: Item[]; loading: boolean } {
  const facts = useQuery(api.settings.setupChecklist, {});
  const config = useChannelConfig();
  const origin = useOrigin();
  if (!facts) return { items: [], loading: true };

  const channelItems = (Object.keys(CHANNEL_WEBHOOK_PATH) as ChannelKey[]).map((channel): Item => {
    const env = config.state === "ready" ? config.channels[channel] : null;
    const missing = env ? Object.entries(env.vars).filter(([, set]) => !set).map(([name]) => name) : [];
    const replied = facts.channelsReplied[channel];
    return {
      id: `channel-${channel}`,
      label: `${sourceLabel(channel)} connected`,
      done: Boolean(env?.configured) && replied,
      detail:
        config.state === "loading"
          ? "Checking the website configuration…"
          : config.state === "error"
            ? `Could not check the website configuration: ${config.message}`
            : missing.length
              ? `Set ${missing.join(", ")} in Vercel, then paste the webhook URL into the ${sourceLabel(channel)} console.`
              : replied
                ? undefined
                : "Configured. Send a test message to confirm the AI replies.",
      href: "/admin/settings?tab=channels",
      linkLabel: "Channel health",
      copy: origin ? { label: "Webhook URL", value: `${origin}${CHANNEL_WEBHOOK_PATH[channel]}` } : undefined,
    };
  });

  const items: Item[] = [
    {
      id: "admins",
      label: "Admin sign-in (Clerk and ADMIN_EMAILS)",
      done: true,
      href: "/admin/settings?tab=admins",
      linkLabel: "Admins",
    },
    {
      id: "profile",
      label: "Business profile saved",
      done: facts.profileSaved,
      detail: "Save your business name, contact details and check-in times.",
      href: "/admin/settings",
      linkLabel: "Business",
    },
    {
      id: "villa",
      label: "A published villa with photos and a price",
      done: facts.villaReady,
      detail: "Add photos and a nightly price, then publish the villa.",
      href: "/admin/properties",
      linkLabel: "Villas",
    },
    {
      id: "ai",
      label: "AI key set",
      done: facts.aiKey,
      detail: "Set AI_API_KEY in the Convex dashboard (Settings, Environment variables).",
      href: "/admin/settings?tab=channels",
      linkLabel: "Backend services",
    },
    {
      id: "email",
      label: "Email sending set up",
      done: facts.email,
      detail: "Set RESEND_API_KEY and EMAIL_FROM in Convex.",
      href: "/admin/settings?tab=email",
      linkLabel: "Email settings",
      testEmail: true,
    },
    {
      id: "stripe",
      label: "Stripe payments set up",
      done: facts.stripe,
      detail: "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Convex, and add the webhook in Stripe.",
      href: "/admin/settings?tab=channels",
      linkLabel: "Backend services",
      copy: CONVEX_SITE ? { label: "Stripe webhook URL", value: `${CONVEX_SITE}/stripe/webhook` } : undefined,
    },
    {
      id: "secret",
      label: "Server secret shared with Convex",
      done: facts.serverSecret,
      detail: "Set the same CONVEX_SERVER_SECRET in Convex and Vercel so channel webhooks are trusted.",
      href: "/admin/settings?tab=channels",
      linkLabel: "Backend services",
    },
    ...channelItems,
    {
      id: "ical",
      label: "An OTA calendar synced",
      done: facts.icalSynced,
      detail: "Import your Airbnb, Booking.com or Agoda iCal feed so their bookings block dates here.",
      href: "/admin/hotel",
      linkLabel: "OTA calendars",
    },
  ];
  return { items, loading: false };
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-xs">{value}</code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 px-2"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        <Copy aria-hidden className="size-3.5" />
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

function TestEmailButton() {
  const sendTestEmail = useAction(api.emails.sendTestEmail);
  const [state, setState] = useState<{ busy: boolean; result?: { ok: boolean; message: string } }>({ busy: false });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          try {
            setState({ busy: false, result: await sendTestEmail({}) });
          } catch (err) {
            setState({ busy: false, result: { ok: false, message: errorText(err, "Could not send the test email.") } });
          }
        }}
      >
        {state.busy ? <Spinner label="Sending" className="size-3.5 text-current" /> : null}
        Send test email
      </Button>
      {state.result ? (
        <span role="status" className={cn("text-xs", state.result.ok ? TONES.success.text : "text-destructive")}>
          {state.result.message}
        </span>
      ) : null}
    </span>
  );
}

/** Setup checklist card for the top of Settings. Starts collapsed once everything is done. */
export function SetupChecklistCard() {
  const { items, loading } = useSetupChecklist();
  if (loading) return null;
  const done = items.filter((item) => item.done).length;
  const complete = done === items.length;

  return (
    <details open={!complete} className="group border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex-1">
          <span className="block text-base font-semibold text-foreground">{complete ? "Setup complete" : "Finish setting up"}</span>
          <span className="block text-xs text-muted-foreground">
            {done} of {items.length} done
          </span>
        </span>
        <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full", TONES.success.dot)} style={{ width: `${(done / items.length) * 100}%` }} />
        </span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((item) => (
          <li key={item.id} className="flex gap-3 px-4 py-3">
            {item.done ? (
              <CheckCircle2 aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", TONES.success.text)} />
            ) : (
              <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="grid min-w-0 flex-1 gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cn("text-sm", item.done ? "text-muted-foreground" : "font-medium text-foreground")}>
                  {item.label}
                  <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                </span>
                <Link href={item.href} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  {item.linkLabel}
                </Link>
              </div>
              {!item.done && item.detail ? <p className="text-xs text-muted-foreground">{item.detail}</p> : null}
              {item.copy ? <CopyButton {...item.copy} /> : null}
              {item.testEmail && item.done ? <TestEmailButton /> : null}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Dismissible reminder on the chats page while setup is incomplete. */
export function SetupBanner({ className }: { className?: string }) {
  const { items, loading } = useSetupChecklist();
  const [dismissed, setDismissed] = useStoredState("admin.setupBanner.dismissed", "");
  const remaining = items.filter((item) => !item.done).length;
  if (loading || remaining === 0 || dismissed === "1") return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border px-4 py-2 text-sm text-foreground",
        TONES.warning.bg,
        TONES.warning.border,
        className,
      )}
    >
      <span className="flex-1">
        Setup: {remaining} {remaining === 1 ? "step" : "steps"} left, starting with “{items.find((item) => !item.done)?.label}”.{" "}
        <Link href="/admin/settings" className="font-medium underline underline-offset-2">
          Open the checklist
        </Link>
      </span>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" aria-label="Dismiss setup reminder" onClick={() => setDismissed("1")}>
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
