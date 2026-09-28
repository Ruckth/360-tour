"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import {
  MAX_WORDS_RANGE,
  validateSettingsInput,
  type EffectiveSettings,
  type SettingsInput,
} from "convex/lib/siteSettings";
import { format } from "date-fns";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChannelConfigStatus, ChannelKey } from "@/lib/admin/channel-config";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "business", label: "Business" },
  { id: "ai", label: "AI assistant" },
  { id: "email", label: "Email" },
  { id: "channels", label: "Channels" },
  { id: "admins", label: "Admins" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const TEXTAREA =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

export function AdminSettingsView() {
  const [tab, setTab] = useState<Tab>("business");
  const settings = useQuery(api.settings.get, {});

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-4 sm:px-6">
      <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-1 border border-border bg-card p-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`settings-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="grid gap-4">
        {tab === "channels" ? (
          <ChannelsPanel />
        ) : tab === "admins" ? (
          <AdminsPanel />
        ) : settings === undefined ? (
          <Loader2 className="mx-auto my-16 size-5 animate-spin text-gold" />
        ) : tab === "business" ? (
          <SettingsForm section="business" settings={settings} />
        ) : tab === "ai" ? (
          <SettingsForm section="ai" settings={settings} />
        ) : (
          <SettingsForm section="email" settings={settings} />
        )}
      </div>
    </div>
  );
}

// ---------- Editable sections ----------

type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "email" | "time" | "number" | "url" | "textarea";
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  required?: boolean;
};

type Section = "business" | "ai" | "email";

const SECTIONS: Record<
  Section,
  { title: string; description: string; fields: (s: EffectiveSettings) => FieldDef[]; values: (s: EffectiveSettings) => Record<string, string> }
> = {
  business: {
    title: "Business profile",
    description: "Used by the AI concierge, emails and the admin. The public website still shows its built-in content.",
    fields: () => [
      { name: "businessName", label: "Business name", required: true },
      { name: "tagline", label: "Tagline" },
      { name: "contactEmail", label: "Contact email", type: "email" },
      { name: "contactPhone", label: "Contact phone" },
      { name: "whatsapp", label: "WhatsApp number" },
      { name: "lineId", label: "LINE ID", placeholder: "@yourline" },
      { name: "lineUrl", label: "LINE URL", type: "url", placeholder: "https://line.me/R/ti/p/@yourline", wide: true },
      { name: "address", label: "Address", wide: true },
      { name: "currency", label: "Currency", placeholder: "THB", required: true },
      { name: "timezone", label: "Time zone", placeholder: "Asia/Bangkok", required: true },
      { name: "checkInTime", label: "Check-in time", type: "time", required: true },
      { name: "checkOutTime", label: "Check-out time", type: "time", required: true },
      {
        name: "cancellationPolicy",
        label: "Cancellation policy",
        type: "textarea",
        hint: "The AI concierge quotes this to guests. Leave blank to not mention a policy.",
        wide: true,
      },
    ],
    values: (s) => ({
      businessName: s.businessName,
      tagline: s.tagline,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      whatsapp: s.whatsapp,
      lineId: s.lineId,
      lineUrl: s.lineUrl,
      address: s.address,
      currency: s.currency,
      timezone: s.timezone,
      checkInTime: s.checkInTime,
      checkOutTime: s.checkOutTime,
      cancellationPolicy: s.cancellationPolicy,
    }),
  },
  ai: {
    title: "AI assistant",
    description: "How the concierge talks to guests on the website, LINE, WhatsApp, Messenger and Instagram.",
    fields: () => [
      { name: "tone", label: "Tone", placeholder: "warm, concise, and helpful", hint: "A few words describing the voice." },
      {
        name: "maxWords",
        label: "Max words per reply",
        type: "number",
        hint: `${MAX_WORDS_RANGE.min}–${MAX_WORDS_RANGE.max}. Longer replies are allowed when a guest asks for detail.`,
      },
      {
        name: "extraInstructions",
        label: "Extra instructions",
        type: "textarea",
        hint: "Added to the end of the concierge prompt, e.g. house rules or things to always mention.",
        wide: true,
      },
    ],
    values: (s) => ({ tone: s.ai.tone, maxWords: String(s.ai.maxWords), extraInstructions: s.ai.extraInstructions }),
  },
  email: {
    title: "Email",
    description: "Booking confirmations, lifecycle emails and staff alerts.",
    fields: (s) => [
      {
        name: "fromName",
        label: "Sender name",
        placeholder: s.businessName,
        hint: "Display name only. The sender address stays in the EMAIL_FROM environment variable.",
      },
      {
        name: "ownerNotificationEmail",
        label: "Owner notification email",
        type: "email",
        placeholder: "Uses OWNER_NOTIFICATION_EMAIL when blank",
        hint: "Receives new-booking notifications and staff alerts.",
      },
      { name: "footer", label: "Footer", type: "textarea", hint: "Shown at the bottom of guest emails. Leave blank for none.", wide: true },
    ],
    values: (s) => ({ fromName: s.email.fromName, ownerNotificationEmail: s.email.ownerNotificationEmail, footer: s.email.footer }),
  },
};

function toInput(section: Section, values: Record<string, string>): SettingsInput {
  if (section === "ai") {
    const maxWords = values.maxWords.trim() === "" ? NaN : Number(values.maxWords);
    return { ai: { tone: values.tone, extraInstructions: values.extraInstructions, maxWords } };
  }
  return { [section]: values };
}

function SettingsForm({ section, settings }: { section: Section; settings: EffectiveSettings }) {
  const config = SECTIONS[section];
  const update = useMutation(api.settings.update);
  const [values, setValues] = useState(() => config.values(settings));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState({ saving: false, saved: false, error: "" });

  const errors = validateSettingsInput(toInput(section, values)).errors;
  const errorFor = (name: string) => {
    const key = section === "business" ? name : `${section}.${name}`;
    return submitted || touched.has(name) ? errors[key] : undefined;
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) {
      setState({ saving: false, saved: false, error: "Fix the highlighted fields and save again." });
      return;
    }
    setState({ saving: true, saved: false, error: "" });
    try {
      await update(toInput(section, values));
      setState({ saving: false, saved: true, error: "" });
    } catch (err) {
      setState({ saving: false, saved: false, error: errorText(err, "Could not save settings.") });
    }
  }

  return (
    <Panel title={config.title} description={config.description}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {config.fields(settings).map((field) => {
            const id = `settings-${section}-${field.name}`;
            const error = errorFor(field.name);
            const describedBy = [error ? `${id}-error` : "", field.hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
            const common = {
              id,
              name: field.name,
              value: values[field.name] ?? "",
              placeholder: field.placeholder,
              "aria-invalid": error ? true : undefined,
              "aria-describedby": describedBy,
              onChange: (event: { target: { value: string } }) => {
                setValues((current) => ({ ...current, [field.name]: event.target.value }));
                setState((current) => ({ ...current, saved: false }));
              },
              onBlur: () => setTouched((current) => new Set(current).add(field.name)),
            };
            return (
              <div key={field.name} className={cn("grid content-start gap-2", field.wide && "sm:col-span-2")}>
                <Label htmlFor={id}>
                  {field.label}
                  {field.required ? <span className="text-muted-foreground"> (required)</span> : null}
                </Label>
                {field.type === "textarea" ? (
                  <textarea {...common} className={cn(TEXTAREA, error && "border-destructive")} />
                ) : (
                  <Input
                    {...common}
                    type={field.type ?? "text"}
                    inputMode={field.type === "number" ? "numeric" : undefined}
                    className={cn(error && "border-destructive")}
                  />
                )}
                {error ? (
                  <p id={`${id}-error`} className="text-xs text-destructive">
                    {error}
                  </p>
                ) : null}
                {field.hint ? (
                  <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                    {field.hint}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={state.saving}>
            {state.saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            Save {config.title.toLowerCase()}
          </Button>
          <span role="status" className="text-sm text-muted-foreground">
            {state.saved ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Check aria-hidden className="size-4" />
                Saved
              </span>
            ) : settings.updatedAt ? (
              `Last saved ${formatTime(settings.updatedAt)}${settings.updatedByEmail ? ` by ${settings.updatedByEmail}` : ""}`
            ) : (
              "Using built-in defaults"
            )}
          </span>
        </div>
      </form>
    </Panel>
  );
}

// ---------- Read-only sections ----------

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  line: "LINE",
  facebook: "Facebook Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

type ConfigStatus = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; channels: ChannelConfigStatus };

function useChannelConfig(): ConfigStatus {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<ConfigStatus>({ state: "loading" });

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

function ChannelsPanel() {
  const health = useQuery(api.settings.channelHealth, {});
  const server = useQuery(api.settings.serverConfig, {});
  const config = useChannelConfig();

  return (
    <>
      <Panel title="Messaging channels" description="Webhook activity from the last events received. Failure counts cover the last 24 hours and 7 days.">
        {config.state === "error" ? (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>Could not check website environment variables: {config.message}</AlertDescription>
          </Alert>
        ) : null}
        {health === undefined ? (
          <Loader2 className="mx-auto my-8 size-5 animate-spin text-gold" />
        ) : (
          <ul className="grid gap-3">
            {health.channels.map((channel) => {
              const env = config.state === "ready" ? config.channels[channel.channel] : null;
              const missing = env ? Object.entries(env.vars).filter(([, set]) => !set).map(([name]) => name) : [];
              return (
                <li key={channel.channel} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="flex-1 text-sm font-semibold text-foreground">{CHANNEL_LABELS[channel.channel]}</h3>
                    {config.state === "loading" ? (
                      <Badge variant="muted">Checking…</Badge>
                    ) : env ? (
                      <Badge variant={env.configured ? "secondary" : "outline"}>{env.configured ? "Configured" : "Not configured"}</Badge>
                    ) : (
                      <Badge variant="muted">Unknown</Badge>
                    )}
                  </div>
                  {missing.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">Missing: {missing.join(", ")}</p>
                  ) : null}
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                    <Stat label="Last event" value={channel.lastEventAt ? formatTime(channel.lastEventAt) : "Never"} />
                    <Stat label="Last reply" value={channel.lastRepliedAt ? formatTime(channel.lastRepliedAt) : "Never"} />
                    <Stat label="Failed (24 h)" value={String(channel.failed24h)} alert={channel.failed24h > 0} />
                    <Stat
                      label="Failed (7 d)"
                      value={`${channel.failed7d}${channel.failedCapped ? "+" : ""}`}
                      alert={channel.failed7d > 0}
                    />
                  </dl>
                  {channel.latestError ? (
                    <p className="mt-3 break-words rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Latest error ({formatTime(channel.latestError.at)}):</span>{" "}
                      {channel.latestError.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Backend services" description="Convex environment variables. Values are never shown, only whether they are set.">
        {server === undefined ? (
          <Loader2 className="mx-auto my-8 size-5 animate-spin text-gold" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {Object.entries(server).map(([name, set]) => (
              <li key={name} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <code className="truncate text-xs">{name}</code>
                <Badge variant={set ? "secondary" : "outline"}>{set ? "Set" : "Missing"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="iCal calendars" description="OTA calendars imported into villa availability. Manage them from Hotel bookings.">
        {health === undefined ? (
          <Loader2 className="mx-auto my-8 size-5 animate-spin text-gold" />
        ) : health.ical.length === 0 ? (
          <p className="text-sm text-muted-foreground">No iCal calendars connected.</p>
        ) : (
          <ul className="divide-y divide-border">
            {health.ical.map((source) => (
              <li key={source._id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {source.propertyName} · {source.platform}
                  </span>
                  <Badge variant={source.lastSyncError ? "outline" : "secondary"}>
                    {source.lastSyncError ? "Sync failed" : source.lastSyncedAt ? "OK" : "Not synced yet"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Last synced: {source.lastSyncedAt ? formatTime(source.lastSyncedAt) : "never"}
                </p>
                {source.lastSyncError ? <p className="break-words text-xs text-destructive">{source.lastSyncError}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function AdminsPanel() {
  const admins = useQuery(api.settings.admins, {});
  return (
    <Panel title="Admins" description="People who can sign in to this dashboard.">
      {admins === undefined ? (
        <Loader2 className="mx-auto my-8 size-5 animate-spin text-gold" />
      ) : (
        <ul className="divide-y divide-border">
          {admins.map((email) => (
            <li key={email} className="py-2 text-sm text-foreground first:pt-0">
              {email}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Change in the Convex <code>ADMIN_EMAILS</code> environment variable (comma-separated).
      </p>
    </Panel>
  );
}

// ---------- Shared bits ----------

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", alert ? "text-destructive" : "text-foreground")}>{value}</dd>
    </div>
  );
}

function formatTime(timestamp: number) {
  return format(timestamp, "d MMM yyyy, HH:mm");
}
