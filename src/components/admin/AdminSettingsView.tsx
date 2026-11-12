"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import {
  BOOKING_RULE_RANGES,
  MAX_WORDS_RANGE,
  validateSettingsInput,
  type EffectiveSettings,
  type SettingsInput,
} from "convex/lib/siteSettings";
import { format } from "date-fns";
import { Check, RotateCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { TimePicker } from "@/components/ui/time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { ConfigurationHistoryRecords, HistoryDisclosure, RecordHistoryPanel, type HistoryEntry } from "./RecordHistoryPanel";
import { SegmentedTabs, tabPanelProps } from "./SegmentedTabs";
import { ADMIN_SETTINGS_TABS, adminSettingsTab, adminSettingsTabPath, type AdminSettingsTab } from "./admin-routes";
import { SetupChecklistCard } from "./SetupChecklist";
import { StatusBadge } from "./StatusBadge";
import { useStaffAccess } from "./staff-access";
import { TeamSettings } from "./TeamSettings";
import { sourceLabel } from "./labels";
import { TONES, statusMeta, type StatusMeta } from "./status-tones";
import { useChannelConfig, type ChannelConfig } from "./useChannelConfig";

const TABS = ADMIN_SETTINGS_TABS;
type Tab = AdminSettingsTab;

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
  const access = useStaffAccess();
  // Managers read settings; only owners change them or see Team. Others see them as before.
  const readOnly = access.role === "manager" || access.role === "cashier";
  const tabs = TABS.filter(({ id }) => id !== "team" || !readOnly);
  // The tab lives in the URL (?tab=email) so the setup checklist can link straight to it.
  const requested = adminSettingsTab(searchParams.get("tab"));
  const tab: Tab = tabs.some(({ id }) => id === requested) ? requested : "business";
  const setTab = (next: Tab) => router.replace(adminSettingsTabPath(next), { scroll: false });
  const legacyTab = searchParams.get("tab") === "admins";
  // Old ?tab=admins links open Team under its own address.
  useEffect(() => {
    if (legacyTab) router.replace(adminSettingsTabPath("team"), { scroll: false });
  }, [legacyTab, router]);
  const settings = useQuery(api.settings.settings.get, {});

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-4 sm:px-6">
      <SetupChecklistCard />
      <SegmentedTabs
        id="settings"
        tabs={tabs.map(({ id, label }) => ({ value: id, label }))}
        value={tab}
        onValueChange={setTab}
        label="Settings sections"
      />

      <div {...tabPanelProps("settings", tab)} className="grid gap-4">
        {tab === "channels" ? (
          <ChannelsPanel />
        ) : tab === "team" ? (
          <TeamSettings />
        ) : settings === undefined ? (
          <PanelSpinner label="Loading settings" />
        ) : tab === "business" ? (
          <SettingsForm key={tab} section="business" settings={settings} readOnly={readOnly} />
        ) : tab === "bookingRules" ? (
          <SettingsForm key={tab} section="bookingRules" settings={settings} readOnly={readOnly} />
        ) : tab === "ai" ? (
          <SettingsForm key={tab} section="ai" settings={settings} readOnly={readOnly} />
        ) : (
          <SettingsForm key={tab} section="email" settings={settings} readOnly={readOnly} />
        )}
      </div>
      <HistoryDisclosure label="Deleted villa history"><ConfigurationHistoryRecords /></HistoryDisclosure>
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

type Section = "business" | "ai" | "email" | "bookingRules";

const SECTIONS: Record<
  Section,
  { title: string; description: string; fields: (s: EffectiveSettings) => FieldDef[]; values: (s: EffectiveSettings) => Record<string, string> }
> = {
  bookingRules: {
    title: "Booking rules",
    description: "Timing and stay limits for online villa bookings. Staff-created bookings are exempt from stay limits and unpaid expiry.",
    fields: () => [
      { name: "unpaidHoldMinutes", label: "Hold unpaid bookings for", type: "number", hint: "Minutes the dates stay reserved while the guest pays. Opening the payment page extends this until that page expires." },
      { name: "chatQuoteValidityMinutes", label: "Chat summary valid for", type: "number", hint: "Minutes a guest has to confirm a booking summary sent in chat." },
      { name: "preArrivalDaysBefore", label: "Pre-arrival email days before check-in", type: "number", hint: "Includes late bookings up to the day before arrival." },
      { name: "reviewDaysAfter", label: "Review email days after check-out", type: "number", hint: "Catches up through 7 days after check-out." },
      { name: "minNights", label: "Minimum nights", type: "number" },
      { name: "maxAdvanceDays", label: "Maximum advance booking days", type: "number" },
      { name: "sameDayCutoff", label: "Same-day booking cutoff", type: "time", hint: "Resort time (Asia/Bangkok). Leave blank for no cutoff." },
    ],
    values: (s) => Object.fromEntries(Object.entries(s.bookingRules).map(([key, value]) => [key, String(value)])),
  },
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
  if (section === "bookingRules") {
    return { bookingRules: {
      ...Object.fromEntries(Object.keys(BOOKING_RULE_RANGES).map(key => [key, values[key].trim() === "" ? NaN : Number(values[key])])),
      sameDayCutoff: values.sameDayCutoff,
    } };
  }
  if (section === "ai") {
    const maxWords = values.maxWords.trim() === "" ? NaN : Number(values.maxWords);
    return { ai: { tone: values.tone, extraInstructions: values.extraInstructions, maxWords } };
  }
  return { [section]: values };
}

function SettingsForm({ section, settings, readOnly = false }: { section: Section; settings: EffectiveSettings & { revision: number }; readOnly?: boolean }) {
  const config = SECTIONS[section];
  const pending = useRef(false);
  const update = useMutation(api.settings.settings.update);
  const restore = useMutation(api.settings.settings.restore);
  const [revision, setRevision] = useState(settings.revision);
  const [savedValues, setSavedValues] = useState(() => config.values(settings));
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
    if (pending.current || readOnly) return;
    setSubmitted(true);
    if (Object.keys(errors).length) {
      setState({ saving: false, saved: false, error: "Fix the highlighted fields and save again." });
      return;
    }
    pending.current = true;
    setState({ saving: true, saved: false, error: "" });
    try {
      await update({ ...toInput(section, values), expectedRevision: revision });
      setRevision(revision + 1);
      setSavedValues(values);
      setState({ saving: false, saved: true, error: "" });
    } catch (err) {
      setState({ saving: false, saved: false, error: errorText(err, "Could not save settings.") });
    } finally {
      pending.current = false;
    }
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues);
  async function applyHistory(entry: HistoryEntry, side: "before" | "after") {
    if (pending.current || dirty) return;
    pending.current = true;
    setState({ saving: true, saved: false, error: "" });
    try {
      const restored = await restore({ historyId: entry._id, expectedRevision: revision, side });
      setValues(config.values(restored));
      setSavedValues(config.values(restored));
      setRevision(restored.revision);
      setState({ saving: false, saved: true, error: "" });
    } catch (err) {
      setState({ saving: false, saved: false, error: errorText(err, "Could not apply configuration.") });
    } finally {
      pending.current = false;
    }
  }

  return (
    <Panel title={config.title} description={config.description}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        {/* Read-only for managers: the fields show the settings, and nothing can be saved. */}
        <fieldset disabled={readOnly} className="grid min-w-0 gap-4 sm:grid-cols-2">
          {config.fields(settings).map((field) => {
            const id = `settings-${section}-${field.name}`;
            const error = errorFor(field.name);
            const describedBy = [error ? `${id}-error` : "", field.hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
            const common = {
              id,
              name: field.name,
              disabled: state.saving,
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
                    disabled={state.saving || readOnly}
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
        </fieldset>

        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {readOnly ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              Read only
              <InfoTip label="Why read only">Only owners can change settings.</InfoTip>
            </span>
          ) : (
            <Button type="submit" disabled={state.saving}>
              {state.saving ? <Spinner label="Saving" className="text-current" /> : null}
              Save {config.title.toLowerCase()}
            </Button>
          )}
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
      {settings.revision > revision ? <p className="mt-3 text-sm text-muted-foreground">Settings changed on another device. Your draft is retained. <Button type="button" variant="outline" size="sm" disabled={state.saving} onClick={() => { const latest = config.values(settings); setValues(latest); setSavedValues(latest); setRevision(settings.revision); setState({ saving: false, saved: false, error: "" }); }}>Load current settings</Button></p> : null}
      {dirty ? <p className="mt-4 text-xs text-muted-foreground">Save your draft before applying an earlier configuration.</p> : null}
      <div className="mt-4"><RecordHistoryPanel entityType="settings" entityId="default" onRestore={readOnly ? undefined : applyHistory} disabled={state.saving || dirty || settings.revision > revision} /></div>
    </Panel>
  );
}

// ---------- Read-only sections ----------

function ChannelsPanel() {
  const health = useQuery(api.settings.settings.channelHealth, {});
  const server = useQuery(api.settings.settings.serverConfig, {});
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
