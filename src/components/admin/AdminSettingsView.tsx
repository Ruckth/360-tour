"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import {
  MAX_WORDS_RANGE,
  validateSettingsInput,
  type EffectiveSettings,
  type SettingsInput,
} from "convex/lib/siteSettings";
import { format } from "date-fns";
import { Check, RotateCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TimePicker } from "@/components/ui/time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { SegmentedTabs, tabPanelProps } from "./SegmentedTabs";
import { SetupChecklistCard } from "./SetupChecklist";
import { StatusBadge } from "./StatusBadge";
import { sourceLabel } from "./labels";
import { TONES, statusMeta, type StatusMeta } from "./status-tones";
import { useChannelConfig, type ChannelConfig } from "./useChannelConfig";

const TABS = [
  { id: "business", label: "Business" },
  { id: "ai", label: "AI assistant" },
  { id: "email", label: "Email" },
  { id: "channels", label: "Channels" },
  { id: "admins", label: "Admins" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function PanelSpinner({ label }: { label: string }) {
  return (
    <div className="grid place-items-center py-10">
      <Spinner label={label} className="size-5" />
    </div>
  );
}

export function AdminSettingsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The tab lives in the URL (?tab=email) so the setup checklist can link straight to it.
  const tab: Tab = TABS.find(({ id }) => id === searchParams.get("tab"))?.id ?? "business";
  const setTab = (next: Tab) => router.replace(next === "business" ? "/admin/settings" : `/admin/settings?tab=${next}`, { scroll: false });
  const settings = useQuery(api.settings.get, {});

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-4 sm:px-6">
      <SetupChecklistCard />
      <SegmentedTabs
        id="settings"
        tabs={TABS.map(({ id, label }) => ({ value: id, label }))}
        value={tab}
        onValueChange={setTab}
        label="Settings sections"
      />

      <div {...tabPanelProps("settings", tab)} className="grid gap-4">
        {tab === "channels" ? (
          <ChannelsPanel />
        ) : tab === "admins" ? (
          <AdminsPanel />
        ) : settings === undefined ? (
          <PanelSpinner label="Loading settings" />
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
                  <Textarea {...common} className={cn("min-h-24", error && "border-destructive")} />
                ) : field.type === "time" ? (
                  <TimePicker
                    id={id}
                    name={field.name}
                    label={field.label}
                    value={common.value}
                    onValueChange={(value) => common.onChange({ target: { value } })}
                    onBlur={common.onBlur}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    allowEmpty
                  />
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
            {state.saving ? <Spinner label="Saving" className="text-current" /> : null}
            Save {config.title.toLowerCase()}
          </Button>
          <span role="status" className="text-sm text-muted-foreground">
            {state.saved ? (
              <span className={cn("inline-flex items-center gap-1", TONES.success.text)}>
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

function ChannelsPanel() {
  const health = useQuery(api.settings.channelHealth, {});
  const server = useQuery(api.settings.serverConfig, {});
  const config = useChannelConfig();

  return (
    <>
      <Panel title="Messaging channels" description="Webhook activity from the last events received. Failure counts cover the last 24 hours and 7 days.">
        {config.state === "error" ? (
          <Alert variant="warning" className="mb-4">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">Could not check website environment variables: {config.message}</span>
              <Button type="button" size="sm" variant="outline" onClick={config.retry}>
                <RotateCw aria-hidden="true" className="size-4" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {health === undefined ? (
          <PanelSpinner label="Loading channel health" />
        ) : (
          <ul className="grid gap-3">
            {health.channels.map((channel) => {
              const env = config.state === "ready" ? config.channels[channel.channel] : null;
              const missing = env ? Object.entries(env.vars).filter(([, set]) => !set).map(([name]) => name) : [];
              return (
                <li key={channel.channel} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="flex-1 text-sm font-semibold text-foreground">{sourceLabel(channel.channel)}</h3>
                    <StatusBadge {...channelHealthMeta(config, env?.configured, channel)} />
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
          <PanelSpinner label="Loading backend services" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {Object.entries(server).map(([name, set]) => (
              <li key={name} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <code className="truncate text-xs">{name}</code>
                <StatusBadge tone={set ? "success" : "muted"} label={set ? "Set" : "Not set"} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="iCal calendars" description="OTA calendars imported into villa availability. Manage them from Hotel bookings.">
        {health === undefined ? (
          <PanelSpinner label="Loading iCal calendars" />
        ) : health.ical.length === 0 ? (
          <p className="text-sm text-muted-foreground">No iCal calendars connected.</p>
        ) : (
          <ul className="divide-y divide-border">
            {health.ical.map((source) => (
              <li key={source._id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {source.propertyName} · {sourceLabel(source.platform)}
                  </span>
                  <StatusBadge
                    tone={source.lastSyncError ? "danger" : source.lastSyncedAt ? "success" : "muted"}
                    label={source.lastSyncError ? "Sync failed" : source.lastSyncedAt ? "Synced" : "Not synced yet"}
                  />
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
        <PanelSpinner label="Loading admins" />
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
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
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

/** Channel status from the website env check plus recent webhook failures. */
function channelHealthMeta(
  config: ChannelConfig,
  configured: boolean | undefined,
  channel: { failed24h: number; failed7d: number; lastEventAt?: number | null },
): StatusMeta {
  if (config.state === "loading") return { tone: "muted", label: "Checking…" };
  if (configured === undefined) return { tone: "muted", label: "Unknown" };
  if (!configured) return statusMeta("channelHealth", "not_configured");
  if (channel.failed24h > 0) return statusMeta("channelHealth", "failing");
  if (channel.failed7d > 0) return statusMeta("channelHealth", "warning");
  if (!channel.lastEventAt) return { tone: "neutral", label: "No messages yet" };
  return statusMeta("channelHealth", "ok");
}

function formatTime(timestamp: number) {
  return format(timestamp, "d MMM yyyy, HH:mm");
}
