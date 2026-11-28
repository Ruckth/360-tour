"use client";

import { staffDateTime } from "@/lib/staff-time";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import {
  CHAT_CHANNEL_LABELS,
  CHAT_REPLY_LIMIT_RANGES,
  BOOKING_RULE_RANGES,
  MAX_WORDS_RANGE,
  validateSettingsInput,
  type EffectiveSettings,
  type SettingsInput,
} from "convex/shared/siteSettings";
import { RotateCw } from "lucide-react";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { Input } from "@/components/ui/input";
import { FieldLabel as Label } from "@/components/ui/label";
import { Toast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { HistoryDisclosure, RecordHistoryPanel, type HistoryEntry } from "./RecordHistoryPanel";
import { SegmentedTabs, tabPanelProps } from "./SegmentedTabs";
import { ADMIN_SETTINGS_TABS, adminSettingsTab, adminSettingsTabPath, isOwnerOnlySettingsTab, type AdminSettingsTab } from "./admin-routes";
import { SetupChecklistCard } from "./SetupChecklist";
import { StatusBadge } from "./StatusBadge";
import { useStaffAccess } from "./staff-access";
import { NumberField } from "./marketing/MarketingBits";
import { TeamSettings } from "./TeamSettings";
import { BranchesSettings } from "./branch/BranchesSettings";
import { sourceLabel } from "./labels";
import { personLabel } from "./person-label";
import { statusMeta, TONES, type StatusMeta } from "./status-tones";
import { useChannelConfig, type ChannelConfig } from "./useChannelConfig";

const TABS = ADMIN_SETTINGS_TABS;
// Checkout rules carries the commerce copy catalog; only its tab loads it.
const CheckoutRulesPanel = lazy(() => import("./checkout-rules/CheckoutRulesPanel").then((module) => ({ default: module.CheckoutRulesPanel })));
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
  // Changing settings needs the settings capability; Team and Branches need manageTeam (owners).
  const readOnly = !access.capabilities.settings;
  // Team and Branches sit near the front so on a phone they start on screen instead of past the edge.
  const tabs = [...TABS]
    .sort(
      (a, b) =>
        Number(b.id === "business") - Number(a.id === "business") ||
        Number(b.id === "team") - Number(a.id === "team") ||
        Number(b.id === "branches") - Number(a.id === "branches"),
    )
    .filter(({ id }) => !isOwnerOnlySettingsTab(id) || access.capabilities.manageTeam);
  // The tab lives in the URL (?tab=email) so the setup checklist can link straight to it.
  const requested = adminSettingsTab(searchParams.get("tab"));
  const tab: Tab = tabs.some(({ id }) => id === requested) ? requested : "business";
  const [dirty, setDirty] = useState(false);
  const { confirmDiscard } = useUnsavedGuard(dirty);
  const setTab = async (next: Tab) => {
    if (next !== tab && await confirmDiscard()) {
      setDirty(false);
      router.replace(adminSettingsTabPath(next), { scroll: false });
    }
  };
  const legacyTab = searchParams.get("tab") === "admins";
  // Old ?tab=admins links open Team under its own address.
  useEffect(() => {
    if (legacyTab) router.replace(adminSettingsTabPath("team"), { scroll: false });
  }, [legacyTab, router]);
  const settings = useQuery(api.settings.settings.get, {});


  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-5 px-4 py-4 sm:px-6 sm:py-6">
      {readOnly && tab !== "checkoutRules" ? (
        <Alert data-testid="read-only-banner">
          <AlertDescription><strong className="font-semibold">Read only.</strong> Only owners can change settings.</AlertDescription>
        </Alert>
      ) : null}
      <SegmentedTabs
        id="settings"
        tabs={tabs.map(({ id, label }) => ({ value: id, label }))}
        value={tab}
        onValueChange={setTab}
        label="Settings sections"
      />
      {tab === "business" ? <SetupChecklistCard /> : null}

      <div {...tabPanelProps("settings", tab)} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        {tab === "channels" ? (
          <ChannelsPanel />
        ) : tab === "checkoutRules" ? (
          <Suspense fallback={<PanelSpinner label="Loading checkout rules" />}><CheckoutRulesPanel onDirtyChange={setDirty} /></Suspense>
        ) : tab === "team" ? (
          <TeamSettings onDirtyChange={setDirty} confirmDiscard={confirmDiscard} />
        ) : tab === "branches" ? (
          <BranchesSettings />
        ) : settings === undefined ? (
          <PanelSpinner label="Loading settings" />
        ) : tab === "business" ? (
          <SettingsForm key={tab} section="business" settings={settings} readOnly={readOnly} onDirtyChange={setDirty} />
        ) : tab === "bookingRules" ? (
          <SettingsForm key={tab} section="bookingRules" settings={settings} readOnly={readOnly} onDirtyChange={setDirty} />
        ) : tab === "ai" ? (
          <SettingsForm key={tab} section="ai" settings={settings} readOnly={readOnly} onDirtyChange={setDirty} />
        ) : (
          <SettingsForm key={tab} section="email" settings={settings} readOnly={readOnly} onDirtyChange={setDirty} />
        )}
      </div>

      {tab !== "business" ? (
        <SetupChecklistCard
          compact
          className={cn((tab === "team" || tab === "branches") && "max-w-4xl")}
        />
      ) : null}
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
  unit?: string;
  wide?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
};

type Section = "business" | "ai" | "email" | "bookingRules";

const SECTIONS: Record<
  Section,
  { title: string; description: string; fields: (s: EffectiveSettings) => FieldDef[]; values: (s: EffectiveSettings) => Record<string, string> }
> = {
  bookingRules: {
    title: "Booking rules",
    description: "Timing and stay limits for online villa bookings; staff-created bookings are exempt from stay limits and unpaid expiry.",
    fields: () => [
      { name: "unpaidHoldMinutes", label: "Hold unpaid bookings for", type: "number", unit: "min", hint: "Minutes the dates stay reserved while the guest pays. Opening the payment page extends this until that page expires." },
      { name: "chatQuoteValidityMinutes", label: "Chat booking quote expires after", type: "number", unit: "min", hint: "Minutes a guest has to confirm a booking summary sent in chat." },
      { name: "preArrivalDaysBefore", label: "Pre-arrival email", type: "number", unit: "days before", hint: "Includes late bookings up to the day before arrival." },
      { name: "reviewDaysAfter", label: "Review request email", type: "number", unit: "days after", hint: "Catches up through 7 days after check-out." },
      { name: "minNights", label: "Minimum stay", type: "number", unit: "nights" },
      { name: "maxAdvanceDays", label: "Book up to", type: "number", unit: "days ahead" },
      { name: "sameDayCutoff", label: "Same-day booking cutoff", type: "time", hint: "Resort time (Asia/Bangkok). Leave blank for no cutoff." },
    ],
    values: (s) => Object.fromEntries(Object.entries(s.bookingRules).map(([key, value]) => [key, String(value)])),
  },
  business: {
    title: "Business profile",
    description: "Used by the AI concierge, guest emails and the admin.",
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
    values: (s) => ({ tone: s.ai.tone, maxWords: String(s.ai.maxWords), extraInstructions: s.ai.extraInstructions, fastReplies: String(s.ai.fastReplies),
      ...Object.fromEntries(Object.entries(s.chatReplyLimits).map(([key, value]) => [`chatReplyLimits.${key}`, String(value)])),
    }),
  },
  email: {
    title: "Email",
    description: "Booking confirmations, lifecycle emails and staff alerts.",
    fields: () => [
      {
        name: "fromName",
        label: "Sender name",
        placeholder: "Same as business name",
        hint: "Name shown on guest emails; the sender address is managed separately.",
      },
      {
        name: "ownerNotificationEmail",
        label: "Owner notification email",
        type: "email",
        placeholder: "Default notification email",
        hint: "Receives new-booking notifications and staff alerts; leave blank to use the default.",
      },
      { name: "footer", label: "Footer", type: "textarea", hint: "Shown at the bottom of guest emails. Leave blank for none.", wide: true },
    ],
    values: (s) => ({ fromName: s.email.fromName, ownerNotificationEmail: s.email.ownerNotificationEmail, footer: s.email.footer }),
  },
};

const FAST_REPLIES_COST = "OpenAI charges 2× its standard token rates for fast replies. In our tests, the first replies after switching cost up to 5× as the prompt cache warmed up.";

function FastRepliesCard({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const id = "settings-ai-fastReplies";
  return (
    <Card className="p-5 lg:p-6">
      <label htmlFor={id} className="flex min-h-11 items-center justify-between gap-4">
        <span className="grid gap-1">
          <span id={`${id}-label`} className="text-[15px] font-semibold">Fast replies</span>
          <span id={`${id}-cost`} className="text-[13px] leading-5 text-muted-foreground">2× OpenAI token rates</span>
        </span>
        <span className="relative inline-flex h-6 w-10 shrink-0">
          <input id={id} type="checkbox" role="switch" aria-labelledby={`${id}-label`} aria-describedby={`${id}-cost`} className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
          <span aria-hidden className="absolute inset-0 rounded-full bg-muted-foreground/70 peer-checked:bg-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50" />
          <span aria-hidden className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
        </span>
      </label>
    </Card>
  );
}

function toInput(section: Section, values: Record<string, string>): SettingsInput {
  if (section === "bookingRules") {
    return { bookingRules: {
      ...Object.fromEntries(Object.keys(BOOKING_RULE_RANGES).map(key => [key, values[key].trim() === "" ? NaN : Number(values[key])])),
      sameDayCutoff: values.sameDayCutoff,
    } };
  }
  if (section === "ai") {
    const maxWords = values.maxWords.trim() === "" ? NaN : Number(values.maxWords);
    return { ai: { tone: values.tone, extraInstructions: values.extraInstructions, maxWords, fastReplies: values.fastReplies === "true" },
      chatReplyLimits: Object.fromEntries(Object.keys(CHAT_REPLY_LIMIT_RANGES).map(key => {
        const value = values[`chatReplyLimits.${key}`];
        return [key, value.trim() === "" ? NaN : Number(value)];
      })),
    };
  }
  return { [section]: values };
}

function SettingsForm({ section, settings, readOnly = false, onDirtyChange }: { section: Section; settings: EffectiveSettings & { revision: number }; readOnly?: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const config = SECTIONS[section];
  const pending = useRef(false);
  const update = useMutation(api.settings.settings.update);
  const restore = useMutation(api.settings.settings.restore);
  const confirm = useConfirm();
  const [revision, setRevision] = useState(settings.revision);
  const [savedValues, setSavedValues] = useState(() => config.values(settings));
  const [values, setValues] = useState(() => config.values(settings));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState({ saving: false, saved: false, error: "" });

  const errors = validateSettingsInput(toInput(section, values)).errors;
  const errorFor = (name: string) => {
    const key = section === "business" || name.startsWith("chatReplyLimits.") ? name : `${section}.${name}`;
    return submitted || touched.has(name) ? errors[key] : undefined;
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || readOnly) return;
    setSubmitted(true);
    if (Object.keys(errors).length) {
      const form = event.currentTarget;
      setState({ saving: false, saved: false, error: "Fix the highlighted fields and save again." });
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
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
  const usingDefaults = section === "business" && !settings.updatedAt && revision === settings.revision;
  const showSaveBar = !readOnly && (dirty || Boolean(state.error));
  useEffect(() => { onDirtyChange(dirty && !readOnly); return () => onDirtyChange(false); }, [dirty, readOnly, onDirtyChange]);
  useEffect(() => {
    if (!state.saved) return;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, saved: false })), 2500);
    return () => window.clearTimeout(timer);
  }, [state.saved]);
  async function applyHistory(entry: HistoryEntry, side: "before" | "after") {
    if (pending.current || dirty) return;
    const snapshot: unknown = entry[side];
    const restoresFast = !settings.ai.fastReplies && typeof snapshot === "object" && snapshot !== null
      && (snapshot as { ai?: { fastReplies?: unknown } }).ai?.fastReplies === true;
    const ok = await confirm({
      title: "Restore settings to before this change?",
      description: `This puts every settings tab back as it was before this change: business, booking rules, AI assistant and email, not just this tab. Extra AI instructions stay as they are.${restoresFast ? ` This turns fast replies back on. ${FAST_REPLIES_COST}` : ""}`,
      confirmLabel: "Restore settings",
    });
    if (!ok || pending.current) return;
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

  async function toggleFastReplies(on: boolean) {
    if (on && !(await confirm({ title: "Turn on fast replies?", description: FAST_REPLIES_COST, confirmLabel: "Turn on fast replies" }))) return;
    setValues((current) => ({ ...current, fastReplies: String(on) }));
    setState((current) => ({ ...current, saved: false }));
  }

  const fields = config.fields(settings);
  const renderField = (field: FieldDef) => {
    const id = `settings-${section}-${field.name}`;
    const error = errorFor(field.name);
    const describedBy = [field.unit && `${id}-unit`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
    const common = {
      id,
      name: field.name,
      min: field.min,
      max: field.max,
      step: field.type === "number" ? 1 : undefined,
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
      <div key={field.name} className={cn("grid min-w-0 content-start gap-2", field.unit && "gap-3", field.wide && "sm:col-span-2")}>
        <span className="flex items-center gap-1.5">
          <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
            {field.label}
            {!field.required && section === "business" ? <span className="text-xs font-normal text-muted-foreground"> (optional)</span> : null}
          </Label>
          {field.hint ? <InfoTip label={`About ${field.label.toLowerCase()}`}>{field.hint}</InfoTip> : null}
        </span>
        {field.type === "textarea" ? (
          <Textarea {...common} className={cn("min-h-24", error && "border-destructive")} />
        ) : field.name === "currency" ? (
          <Select value={common.value} onValueChange={(value) => common.onChange({ target: { value } })} disabled={state.saving || readOnly}>
            <SelectTrigger id={id} aria-label={field.label} aria-invalid={Boolean(error)} aria-describedby={describedBy} onBlur={common.onBlur} className="w-full font-normal"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from(new Set([common.value, "THB", "USD", "EUR"].filter(Boolean))).map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent>
          </Select>
        ) : field.name === "timezone" ? (
          <Combobox items={Array.from(new Set([common.value, ...Intl.supportedValuesOf("timeZone")].filter(Boolean)))} value={common.value} onValueChange={(value) => { if (value) common.onChange({ target: { value } }); }} disabled={state.saving || readOnly}>
            <ComboboxInput containerClassName="m-0" id={id} aria-label={field.label} aria-invalid={Boolean(error)} aria-describedby={describedBy} onBlur={common.onBlur} />
            <ComboboxContent><ComboboxEmpty className="p-3 text-sm text-muted-foreground">No time zones found.</ComboboxEmpty><ComboboxList>{(zone: string) => <ComboboxItem key={zone} value={zone} className="pointer-coarse:min-h-11">{zone}</ComboboxItem>}</ComboboxList></ComboboxContent>
          </Combobox>
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
            variant="compact"
            allowEmpty={!field.required}
            placeholder={field.name === "sameDayCutoff" ? "No cutoff" : undefined}
          />
        ) : field.unit ? (
          <>
            <div className="sm:max-w-56">
              <NumberField {...common} suffix={field.unit} className={cn("pr-28", error && "border-destructive")} />
            </div>
            <span id={`${id}-unit`} className="sr-only">{field.unit === "min" ? "minutes" : field.unit}</span>
          </>
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
      </div>
    );
  };
  const replyFields: FieldDef[] = Object.entries(CHAT_REPLY_LIMIT_RANGES).map(([key, [min, max]]) => ({
    name: `chatReplyLimits.${key}`,
    label: key === "perChat" ? "Each chat" : CHAT_CHANNEL_LABELS[key as keyof typeof CHAT_CHANNEL_LABELS],
    type: "number",
    unit: "per hour",
    min, max,
    hint: key === "perChat" ? "Stops one guest from using up a channel’s allowance." : undefined,
  }));
  const businessGroups = [
    { title: "Identity", description: "The name and welcome guests see", names: ["businessName", "tagline"] },
    { title: "Contact", description: "Where guests can reach your team", names: ["contactEmail", "contactPhone", "whatsapp", "lineId", "lineUrl"] },
    { title: "Location & currency", description: "Your address, local currency and time", names: ["address", "currency", "timezone"] },
    { title: "Check-in, check-out & policy", description: "Arrival times and cancellation terms", names: ["checkInTime", "checkOutTime", "cancellationPolicy"] },
  ];

  return (
    <Panel title={config.title} description={config.description} grouped>
      <form onSubmit={submit} noValidate className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5", showSaveBar && "pb-20")}>
      {settings.revision > revision ? <Alert variant="warning"><AlertDescription>Settings changed on another device. Your draft is retained. <Button type="button" variant="outline" size="sm" disabled={state.saving} onClick={() => { const latest = config.values(settings); setValues(latest); setSavedValues(latest); setRevision(settings.revision); setState({ saving: false, saved: false, error: "" }); }}>Load current settings</Button></AlertDescription></Alert> : null}
        {/* Read-only for managers: the fields show the settings, and nothing can be saved. */}
        <fieldset disabled={readOnly} data-readonly={readOnly || undefined} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 [&[data-readonly]_input]:opacity-100 [&[data-readonly]_textarea]:opacity-100 [&[data-readonly]_button]:opacity-100 [&[data-readonly]_input]:text-foreground [&[data-readonly]_textarea]:text-foreground">
          {section === "business" ? businessGroups.map((group) => (
            <Card key={group.title} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-5 lg:grid-cols-[1fr_2fr] lg:gap-8 lg:p-6">
              <header className="min-w-0">
                <h3 className="text-balance text-[15px] font-semibold">{group.title}</h3>
                <p className="mt-1 text-pretty text-[13px] leading-5 text-muted-foreground">{group.description}</p>
              </header>
              <div className="grid min-w-0 content-start grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-5 sm:grid-cols-2">{fields.filter((field) => group.names.includes(field.name)).map(renderField)}</div>
            </Card>
          )) : <Card className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-5 sm:grid-cols-2 lg:p-6">{fields.map(renderField)}</Card>}
          {section === "ai" ? <FastRepliesCard
            checked={values.fastReplies === "true"}
            disabled={state.saving || readOnly}
            onChange={(on) => { void toggleFastReplies(on); }}
          /> : null}
          {section === "ai" ? <Card role="region" aria-label="Reply limits" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-5 lg:p-6">
            <header className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold">Reply limits</h3>
                <InfoTip label="About reply limits">The five channel allowances add together; each chat also has its own limit. Website messages count during staff replies; other channels pause counting while staff take over. Changes apply from the next message, and each limit value has its own hourly count. At the limit, website guests keep their unsent draft; messages from other channels still reach your inbox without an AI reply.</InfoTip>
              </div>
              <output className="mt-1 block text-[13px]">
                Channel total: {Object.keys(CHAT_CHANNEL_LABELS).reduce((total, key) => total + (Number(values[`chatReplyLimits.${key}`]) || 0), 0).toLocaleString()} guest messages/hour
              </output>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Default total: 2,500 guest messages/hour across five channels</p>
            </header>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">{replyFields.map(renderField)}</div>
          </Card> : null}
        </fieldset>

      <Card className="min-w-0 px-5 py-3 lg:px-6 [&>details]:border-t-0">
        <HistoryDisclosure hint={settings.updatedAt ? `Last saved ${formatTime(settings.updatedAt)}${settings.updatedByEmail ? ` by ${personLabel(settings.updatedByEmail)}` : ""}` : usingDefaults ? "Using built-in defaults" : undefined}>
          {dirty && !readOnly ? <p className="text-xs text-muted-foreground">Save or discard your changes first.</p> : null}
          <RecordHistoryPanel
            entityType="settings"
            entityId="default"
            title="Settings history"
            restoreLabel="Restore settings to before this"
            onRestore={readOnly ? undefined : applyHistory}
            disabled={state.saving || dirty || settings.revision > revision}
          />
        </HistoryDisclosure>
        {usingDefaults && !readOnly ? <Button type="submit" variant="outline" disabled={state.saving || dirty} className="mb-2">{state.saving ? <Spinner label="Saving defaults" /> : null}Save defaults</Button> : null}
      </Card>

        {showSaveBar ? <StickyActionBar data-testid="settings-save-bar">
          <span role={state.error ? "alert" : "status"} className={cn("mr-auto text-sm", state.error ? "text-destructive" : "text-muted-foreground")}>{state.error || "Unsaved changes"}</span>
          {dirty ? <Button type="button" variant="ghost" disabled={state.saving} onClick={() => { setValues(savedValues); setTouched(new Set()); setSubmitted(false); setState({ saving: false, saved: false, error: "" }); }}>Discard</Button> : null}
          <Button type="submit" disabled={state.saving}>{state.saving ? <Spinner label="Saving" className="text-current" /> : null}Save</Button>
        </StickyActionBar> : null}
      </form>
      {state.saved ? <Toast current={{ id: revision, message: "Saved" }} /> : null}
    </Panel>
  );
}

// ---------- Read-only sections ----------

function ChannelsPanel() {
  const health = useQuery(api.settings.settings.channelHealth, {});
  // Fixed at mount: "Receiving" means a message arrived in the last week, not just ever.
  const [now] = useState(() => Date.now());
  const server = useQuery(api.settings.settings.serverConfig, {});
  const config = useChannelConfig();

  return (
    <Panel title="Channels" description="Messages coming in from LINE, WhatsApp, Messenger and Instagram." grouped>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
        <Panel title="Messaging channels" description="Webhook activity from the last events received. Failure counts cover the last 24 hours and 7 days.">
          {config.state === "error" ? (
            <Alert variant="warning" className="mb-4 flex flex-wrap items-center gap-3 leading-relaxed">
              <div className="min-w-0 flex-1">
                <p>Couldn&apos;t check channel setup. Recent message activity is still shown.</p>
                <details className="mt-1 text-xs">
                  <summary className="min-h-11 cursor-pointer content-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Technical details</summary>
                  <p className="break-words py-2 [overflow-wrap:anywhere]">{config.message}</p>
                </details>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={config.retry}>
                <RotateCw aria-hidden="true" className="size-4" />
                Retry
              </Button>
            </Alert>
          ) : null}
          {health === undefined ? (
            <PanelSpinner label="Loading channel health" />
          ) : (
            <ul className="min-w-0 divide-y divide-border">
              {health.channels.map((channel) => {
                const env = config.state === "ready" ? config.channels[channel.channel] : null;
                const missing = env ? Object.entries(env.vars).filter(([, set]) => !set).map(([name]) => name) : [];
                return (
                  <li key={channel.channel} className="min-w-0 py-4 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 break-words text-[15px] font-medium text-foreground">{sourceLabel(channel.channel)}</h3>
                      <StatusBadge {...channelHealthMeta(config, env?.configured, channel, now)} />
                    </div>
                    {missing.length ? (
                      <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">Missing: {missing.map(channelSetupLabel).join(", ")}</p>
                    ) : null}
                    <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                      <Stat label="Last message in" value={channel.lastEventAt ? formatTime(channel.lastEventAt) : "Never"} />
                      <Stat label="Last reply" value={channel.lastRepliedAt ? formatTime(channel.lastRepliedAt) : "Never"} />
                      <Stat label="Failed replies · 24 h" value={String(channel.failed24h)} alert={channel.failed24h > 0} />
                      <Stat
                        label="Failed replies · 7 d"
                        value={`${channel.failed7d}${channel.failedCapped ? "+" : ""}`}
                        warning={channel.failed7d > 0}
                      />
                    </dl>
                    {channel.latestError ? (
                      <p className="mt-3 break-words rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        <span className="font-semibold text-foreground">Latest error ({formatTime(channel.latestError.at)}):</span>{" "}
                        {channel.latestError.message}
                      </p>
                    ) : channel.failed24h > 0 || channel.failed7d > 0 ? (
                      <p className="mt-3 text-[13px] text-muted-foreground">{channel.failed7d}{channel.failedCapped ? "+" : ""} {channel.failed7d === 1 && !channel.failedCapped ? "reply" : "replies"} failed in the last 7 days</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Backend services" description="Setup for payments, email and the AI assistant. Secret values are never shown.">
          {server === undefined ? (
            <PanelSpinner label="Loading backend services" />
          ) : (
            <ul className="min-w-0 divide-y divide-border">
              {Object.entries(server).map(([name, set]) => (
                <li key={name} className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0 break-words text-sm">{channelSetupLabel(name)}</span>
                  <StatusBadge tone={set ? "success" : "muted"} label={set ? "Set" : "Not set"} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Panel>
  );
}

// ---------- Shared bits ----------

/** A settings panel. Its explanation sits behind the ⓘ beside the title. */
function Panel({ title, description, children, grouped = false }: { title: string; description: string; children: ReactNode; grouped?: boolean }) {
  const Surface = grouped ? "section" : Card;
  return (
    <Surface role="region" className={cn("min-w-0", grouped && "grid grid-cols-[minmax(0,1fr)] gap-5")} aria-label={title}>
      <header className={cn("min-w-0", grouped ? "px-1 pt-1" : "border-b border-border px-5 py-4")}>
        <h2 className={cn("flex items-center gap-2 text-foreground", grouped ? "font-serif text-3xl" : "text-base font-semibold")}>
          {title}
          {!grouped ? <InfoTip label={`About ${title.toLowerCase()}`}>{description}</InfoTip> : null}
        </h2>
        {grouped ? <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      </header>
      <div className={cn("min-w-0", !grouped && "p-5")}>{children}</div>
    </Surface>
  );
}

function Stat({ label, value, alert, warning }: { label: string; value: string; alert?: boolean; warning?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words font-medium", alert ? "text-destructive" : warning ? TONES.warning.text : "text-foreground")}>{value}</dd>
    </div>
  );
}

/** Human names for setup requirements; never expose credential values. */
function channelSetupLabel(name: string) {
  const services: Record<string, string> = {
    AI_API_KEY: "AI assistant", OPENAI_API_KEY: "AI assistant", RESEND_API_KEY: "Email sending",
    EMAIL_FROM: "Sender address", OWNER_NOTIFICATION_EMAIL: "Staff notification address",
    STRIPE_SECRET_KEY: "Stripe payments", STRIPE_WEBHOOK_SECRET: "Stripe payment notifications",
    CONVEX_SERVER_SECRET: "Website connection", LINE_CHANNEL_SECRET: "LINE message verification",
  };
  if (services[name]) return services[name];
  if (name.includes("SECRET")) return "Message verification";
  if (name.includes("VERIFY_TOKEN")) return "Webhook verification";
  if (name.includes("ACCESS_TOKEN")) return "Message sending";
  return name.toLowerCase().replaceAll("_", " ");
}

/** Channel status from the website env check plus recent webhook failures. */
const RECENT_EVENT_MS = 7 * 24 * 60 * 60 * 1000;

function channelHealthMeta(
  config: ChannelConfig,
  configured: boolean | undefined,
  channel: { failed24h: number; failed7d: number; lastEventAt?: number | null },
  now: number,
): StatusMeta {
  if (channel.failed24h > 0) return statusMeta("channelHealth", "failing");
  if (channel.failed7d > 0) return statusMeta("channelHealth", "warning");
  const recent = channel.lastEventAt != null && now - channel.lastEventAt <= RECENT_EVENT_MS;
  if (configured === undefined) {
    if (recent) return { tone: "success", label: "Receiving" };
    return { tone: "muted", label: config.state === "loading" ? "Checking…" : "Not checked" };
  }
  if (!configured) return statusMeta("channelHealth", "not_configured");
  if (!channel.lastEventAt) return { tone: "neutral", label: "No messages yet" };
  return recent ? { tone: "success", label: "Receiving" } : { tone: "neutral", label: "No recent messages" };
}

function formatTime(timestamp: number) {
  return staffDateTime(timestamp);
}
