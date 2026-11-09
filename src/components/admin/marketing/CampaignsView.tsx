"use client";

import type { Id } from "convex/_generated/dataModel";
import { Archive, CircleStop, Megaphone, Pause, Pencil, Play, Plus, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedTabs } from "../SegmentedTabs";
import { StatusBadge } from "../StatusBadge";
import { EmptyState, SearchBox, SkeletonRows } from "../admin-bulk";
import {
  CouponChip,
  EditorSheet,
  FieldError,
  FirstRunEmpty,
  FieldHint,
  NoticeBar,
  NumberField,
  RowMenu,
  SheetForm,
  SlugChip,
  countTabs,
  useConfirmedChange,
  useEditorForm,
  useEditorSheet,
  useNotice,
  type RowAction,
} from "./MarketingBits";
import { parseWhole, wholeText } from "./coupon-form";
import { CAMPAIGN_STATUS, COUPON_STATE, LINK_STATUS, benefitLabel, countLabel, couponState, formatRange, thb } from "./marketing-format";
import type { CampaignRow, CampaignStatus, CouponRow, LinkRow, MarketingActions } from "./types";

type Tab = "all" | CampaignStatus;

const PRESETS = [
  { name: "Facebook · Always on", source: "facebook", medium: "social" },
  { name: "Google Maps · Profile", source: "google", medium: "organic" },
  { name: "Instagram · Always on", source: "instagram", medium: "social" },
  { name: "LINE · Rich menu", source: "line", medium: "messaging" },
] as const;

const SOURCE_SUGGESTIONS = ["facebook", "instagram", "google", "line", "tiktok", "print", "email", "partner"];
const MEDIUM_SUGGESTIONS = ["social", "paid_social", "cpc", "organic", "messaging", "referral", "qr", "email", "affiliate"];

type CampaignsViewProps = {
  campaigns?: CampaignRow[];
  links?: LinkRow[];
  coupons?: CouponRow[];
  today: string;
  linksHref: string;
  couponHref: (couponId: Id<"coupons">) => string;
  actions: Pick<MarketingActions, "saveCampaign" | "setCampaignStatus">;
  /** Renders the change history of a saved record (MarketingScreens passes RecordHistoryPanel). */
  history?: (campaignId: Id<"marketingCampaigns">) => ReactNode;
  /** Renders a saved campaign's Spend section (MarketingScreens passes CampaignSpendSection). */
  spend?: (campaign: CampaignRow) => ReactNode;
};

/** The status changes a campaign can make from where it is. */
function nextStatuses(status: CampaignStatus): { status: CampaignStatus; label: string; icon: typeof Play; destructive?: boolean }[] {
  switch (status) {
    case "draft":
      return [{ status: "active", label: "Start", icon: Send }];
    case "active":
      return [
        { status: "paused", label: "Pause", icon: Pause },
        { status: "ended", label: "End", icon: CircleStop, destructive: true },
      ];
    case "paused":
      return [
        { status: "active", label: "Resume", icon: Play },
        { status: "ended", label: "End", icon: CircleStop, destructive: true },
      ];
    case "ended":
      return [{ status: "archived", label: "Archive", icon: Archive }];
    case "archived":
      return [{ status: "ended", label: "Unarchive", icon: Undo2 }];
  }
}

const STATUS_COPY: Record<CampaignStatus, (name: string) => { title: string; description: string; done: string }> = {
  active: (name) => ({ title: `Start “${name}”?`, description: "Its links and coupons count towards it from now on.", done: `${name} is active` }),
  paused: (name) => ({
    title: `Pause “${name}”?`,
    description: "Its links keep working. Reporting continues, so you can resume later.",
    done: `${name} is paused`,
  }),
  ended: (name) => ({ title: `End “${name}”?`, description: "Reports and history stay. Archive it when you no longer need it in the list.", done: `${name} has ended` }),
  archived: (name) => ({ title: `Archive “${name}”?`, description: "It leaves the list. Its reports stay.", done: `${name} is archived` }),
  draft: (name) => ({ title: name, description: "", done: name }),
};

export function CampaignsView({ campaigns, links, coupons, today, linksHref, couponHref, actions, history, spend }: CampaignsViewProps) {
  const { notice, show, clear } = useNotice();
  const { pending, run } = useConfirmedChange<Id<"marketingCampaigns">>(show);
  const sheet = useEditorSheet<{ campaign?: CampaignRow; preset?: (typeof PRESETS)[number] }>();
  const editing = sheet.editing;
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");

  const all = campaigns ?? [];
  const visible = all.filter((campaign) => campaign.status !== "archived");
  const archivedCount = all.length - visible.length;
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((campaign) => (tab === "all" ? campaign.status !== "archived" : campaign.status === tab))
    .filter((campaign) => !q || [campaign.name, campaign.source, campaign.medium, campaign.notes ?? ""].join(" ").toLowerCase().includes(q));
  const count = (status: CampaignStatus) => all.filter((campaign) => campaign.status === status).length;
  const tabs: { value: Tab; label: string; n: number }[] = [
    { value: "all", label: "All", n: visible.length },
    { value: "active", label: "Active", n: count("active") },
    { value: "draft", label: "Draft", n: count("draft") },
    { value: "paused", label: "Paused", n: count("paused") },
    { value: "ended", label: "Ended", n: count("ended") },
    ...(archivedCount || tab === "archived" ? [{ value: "archived" as const, label: "Archived", n: archivedCount }] : []),
  ];

  const openNew = (preset?: (typeof PRESETS)[number]) => sheet.open({ preset });
  const openEdit = (campaign: CampaignRow) => sheet.open({ campaign });

  function changeStatus(campaign: CampaignRow, status: CampaignStatus, destructive = false) {
    const copy = STATUS_COPY[status](campaign.name);
    return run(
      campaign._id,
      { title: copy.title, description: copy.description, confirmLabel: status === "ended" ? "End campaign" : "Confirm", destructive },
      () => actions.setCampaignStatus({ campaignId: campaign._id, status }),
      copy.done,
      "Couldn’t change the campaign.",
    );
  }

  const menu = (campaign: CampaignRow): RowAction[] => [
    { label: "Edit", icon: Pencil, onSelect: () => openEdit(campaign) },
    ...nextStatuses(campaign.status).map(({ status, label, icon, destructive }) => ({
      label,
      icon,
      destructive,
      disabled: pending === campaign._id,
      onSelect: () => void changeStatus(campaign, status, destructive),
    })),
  ];

  const dates = (campaign: CampaignRow) => (campaign.startsOn || campaign.endsOn ? formatRange(campaign.startsOn, campaign.endsOn) : "Ongoing");
  const sourceMedium = (campaign: CampaignRow) => `${campaign.source} · ${campaign.medium}`;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-4 sm:px-6">
      <section className="min-w-0 border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <p className="min-w-60 flex-1 text-sm text-muted-foreground">
            Each campaign groups the links and coupons for one push, and sets the source and medium its visits report as.
          </p>
          {all.length ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <SearchBox value={query} onChange={setQuery} label="Search campaigns" />
              <Button size="sm" onClick={() => openNew()} className="w-full sm:w-auto">
                <Plus aria-hidden className="size-4" />
                New campaign
              </Button>
            </div>
          ) : null}
        </div>
        <NoticeBar notice={notice} onClose={clear} />

        {campaigns === undefined ? (
          <SkeletonRows label="Loading campaigns" />
        ) : all.length === 0 ? (
          <FirstRunEmpty
            icon={Megaphone}
            title="No campaigns yet"
            description="A campaign groups the links and coupons for one push, like “Facebook · November escape”, so you can see what it brought in."
          >
            <Button size="sm" onClick={() => openNew()}>
              <Plus aria-hidden className="size-4" />
              New campaign
            </Button>
            <div className="mt-4 grid justify-items-center gap-2">
              <p className="admin-eyebrow">Or start with an always-on one</p>
              <div className="flex flex-wrap justify-center gap-2">
                {PRESETS.map((preset) => (
                  <Button key={preset.name} type="button" size="sm" variant="outline" onClick={() => openNew(preset)}>
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
          </FirstRunEmpty>
        ) : (
          <>
            <div className="px-4 pt-3">
              <SegmentedTabs
                label="Campaign status"
                controls="marketing-campaigns-list"
                value={tab}
                onValueChange={setTab}
                tabs={countTabs(tabs)}
              />
            </div>
            <div id="marketing-campaigns-list">
              {shown.length === 0 ? (
                <EmptyState
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTab("all");
                        setQuery("");
                      }}
                    >
                      Show all campaigns
                    </Button>
                  }
                >
                  {q ? `No campaigns match “${query.trim()}”.` : tab === "all" ? "Only archived campaigns left." : `No ${CAMPAIGN_STATUS[tab].label.toLowerCase()} campaigns.`}
                </EmptyState>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="admin-eyebrow border-b border-border bg-muted/40">
                        <tr>
                          <th scope="col" className="px-4 py-3">
                            Campaign
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Dates
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Status
                          </th>
                          <th scope="col" className="px-4 py-3 text-right">
                            Links
                          </th>
                          <th scope="col" className="px-4 py-3 text-right">
                            Coupons
                          </th>
                          <th scope="col" className="hidden px-4 py-3 text-right lg:table-cell">
                            Budget
                          </th>
                          <th scope="col" className="px-4 py-3 text-right">
                            Opens
                          </th>
                          <th scope="col" className="py-3 pe-3">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((campaign) => (
                          <tr key={campaign._id} className="border-b border-border align-top last:border-b-0 hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => openEdit(campaign)}
                                className="rounded text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {campaign.name}
                              </button>
                              <span className="block font-mono text-xs text-muted-foreground">{sourceMedium(campaign)}</span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dates(campaign)}</td>
                            <td className="px-4 py-3">
                              <StatusBadge {...CAMPAIGN_STATUS[campaign.status]} />
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{countLabel(campaign.linkCount, campaign.countsCapped)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{countLabel(campaign.couponCount, campaign.countsCapped)}</td>
                            <td className="hidden whitespace-nowrap px-4 py-3 text-right tabular-nums lg:table-cell">
                              {campaign.budget !== undefined ? thb(campaign.budget) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums">{countLabel(campaign.opens, campaign.countsCapped)}</td>
                            <td className="py-2 pe-3 text-right">
                              <RowMenu label={`Actions for ${campaign.name}`} actions={menu(campaign)} className="size-9" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y divide-border md:hidden">
                    {shown.map((campaign) => (
                      <li key={campaign._id} className="flex items-start gap-1 py-1 pe-2">
                        <button
                          type="button"
                          onClick={() => openEdit(campaign)}
                          className="grid min-w-0 flex-1 gap-2 px-4 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <span className="flex items-start gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground">{campaign.name}</span>
                              <span className="block font-mono text-xs text-muted-foreground">{sourceMedium(campaign)}</span>
                            </span>
                            <StatusBadge {...CAMPAIGN_STATUS[campaign.status]} />
                          </span>
                          <span className="text-xs text-muted-foreground">{dates(campaign)}</span>
                          <span className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                            <span>
                              <span className="block text-muted-foreground">Links</span>
                              <span className="font-semibold tabular-nums text-foreground">{countLabel(campaign.linkCount, campaign.countsCapped)}</span>
                            </span>
                            <span>
                              <span className="block text-muted-foreground">Coupons</span>
                              <span className="font-semibold tabular-nums text-foreground">{countLabel(campaign.couponCount, campaign.countsCapped)}</span>
                            </span>
                            <span>
                              <span className="block text-muted-foreground">Opens</span>
                              <span className="font-semibold tabular-nums text-foreground">{countLabel(campaign.opens, campaign.countsCapped)}</span>
                            </span>
                          </span>
                        </button>
                        <RowMenu label={`Actions for ${campaign.name}`} actions={menu(campaign)} className="mt-1" />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              Opens count visits to the campaign’s short links, bots excluded. Bookings and spend reports come in a later release.
            </p>
          </>
        )}
      </section>

      <EditorSheet
        open={editing !== null}
        onClose={() => void sheet.close()}
        header={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle>{editing?.campaign ? editing.campaign.name : "New campaign"}</SheetTitle>
              {editing?.campaign ? <StatusBadge {...CAMPAIGN_STATUS[editing.campaign.status]} /> : null}
            </div>
            <SheetDescription>{editing?.campaign ? "Edit the details, or change its status." : "It starts as a draft."}</SheetDescription>
          </>
        }
      >
        {editing ? (
          <CampaignEditor
            key={editing.key}
            campaign={editing.campaign ? (all.find((item) => item._id === editing.campaign!._id) ?? editing.campaign) : undefined}
            preset={editing.preset}
            campaigns={all}
            links={links}
            coupons={coupons}
            today={today}
            linksHref={linksHref}
            couponHref={couponHref}
            pending={pending !== null}
            actions={actions}
            history={history}
            spend={spend}
            onStatus={changeStatus}
            onDone={(message) => {
              sheet.done();
              show(message);
            }}
            onCancel={() => void sheet.close()}
            onDirtyChange={sheet.setDirty}
          />
        ) : null}
      </EditorSheet>
    </div>
  );
}

type Form = { name: string; source: string; medium: string; startsOn: string; endsOn: string; budget: string; notes: string };

function CampaignEditor({
  campaign,
  preset,
  campaigns,
  links,
  coupons,
  today,
  linksHref,
  couponHref,
  pending,
  actions,
  history,
  spend,
  onStatus,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  campaign?: CampaignRow;
  preset?: (typeof PRESETS)[number];
  campaigns: CampaignRow[];
  links?: LinkRow[];
  coupons?: CouponRow[];
  today: string;
  linksHref: string;
  couponHref: (couponId: Id<"coupons">) => string;
  pending: boolean;
  actions: CampaignsViewProps["actions"];
  history?: CampaignsViewProps["history"];
  spend?: CampaignsViewProps["spend"];
  onStatus: (campaign: CampaignRow, status: CampaignStatus, destructive?: boolean) => Promise<void>;
  onDone: (message: string) => void;
  onCancel: () => void;
  /** Reports unsaved edits, so the sheet can ask before closing. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = useId();
  const { form, set, submitted, saving, saveError, submit } = useEditorForm<Form>(
    () => ({
      name: campaign?.name ?? preset?.name ?? "",
      source: campaign?.source ?? preset?.source ?? "",
      medium: campaign?.medium ?? preset?.medium ?? "",
      startsOn: campaign?.startsOn ?? "",
      endsOn: campaign?.endsOn ?? "",
      budget: wholeText(campaign?.budget),
      notes: campaign?.notes ?? "",
    }),
    onDirtyChange,
  );

  const budget = parseWhole(form.budget);
  const duplicate = campaigns.some((other) => other._id !== campaign?._id && other.name.trim().toLowerCase() === form.name.trim().toLowerCase());
  const errors = {
    name: !form.name.trim() ? "Give the campaign a name" : duplicate ? "Another campaign already has this name" : "",
    source: form.source.trim() ? "" : "Add the source, e.g. facebook",
    medium: form.medium.trim() ? "" : "Add the medium, e.g. social",
    endsOn: form.startsOn && form.endsOn && form.endsOn < form.startsOn ? "End on or after the start date" : "",
    budget: budget !== undefined && Number.isNaN(budget) ? "Use a whole number of baht" : "",
  };
  const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find((key) => errors[key]);
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : "");

  const save = (event: FormEvent) =>
    submit(event, firstError && `${id}-${firstError}`, async () => {
      await actions.saveCampaign({
        campaignId: campaign?._id,
        name: form.name.trim(),
        source: form.source.trim().toLowerCase(),
        medium: form.medium.trim().toLowerCase(),
        startsOn: form.startsOn || undefined,
        endsOn: form.endsOn || undefined,
        budget: budget === undefined || Number.isNaN(budget) ? undefined : budget,
        notes: form.notes.trim() || undefined,
      });
      onDone(campaign ? `Saved ${form.name.trim()}` : `Created ${form.name.trim()} as a draft`);
    }, "Couldn’t save the campaign.");

  const campaignLinks = campaign ? (links ?? []).filter((link) => link.campaignId === campaign._id) : [];
  const campaignCoupons = campaign ? (coupons ?? []).filter((coupon) => coupon.campaignId === campaign._id) : [];
  const field = (key: keyof typeof errors) => ({
    id: `${id}-${key}`,
    "aria-invalid": shown(key) ? true : undefined,
    "aria-describedby": `${id}-${key}-error ${id}-${key}-hint`,
  });

  return (
    <SheetForm onSubmit={save} onCancel={onCancel} saving={saving} error={saveError} submitLabel={campaign ? "Save changes" : "Create campaign"}>
      {campaign ? (
        <div className="flex flex-wrap gap-2">
          {nextStatuses(campaign.status).map(({ status, label, icon: Icon, destructive }) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              className={destructive ? "text-destructive" : undefined}
              onClick={() => void onStatus(campaign, status, destructive)}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input {...field("name")} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. Facebook · December getaway" autoComplete="off" />
        <FieldError id={`${id}-name-error`}>{shown("name")}</FieldError>
        <FieldHint id={`${id}-name-hint`}>Channel first, then the push. Staff see this name; guests never do.</FieldHint>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-source`}>Source</Label>
          <Input {...field("source")} list={`${id}-sources`} value={form.source} onChange={(event) => set("source", event.target.value)} className="font-mono" autoCapitalize="none" autoComplete="off" spellCheck={false} />
          <datalist id={`${id}-sources`}>
            {SOURCE_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <FieldError id={`${id}-source-error`}>{shown("source")}</FieldError>
          <FieldHint id={`${id}-source-hint`}>Where visits come from, like facebook or google.</FieldHint>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-medium`}>Medium</Label>
          <Input {...field("medium")} list={`${id}-mediums`} value={form.medium} onChange={(event) => set("medium", event.target.value)} className="font-mono" autoCapitalize="none" autoComplete="off" spellCheck={false} />
          <datalist id={`${id}-mediums`}>
            {MEDIUM_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <FieldError id={`${id}-medium-error`}>{shown("medium")}</FieldError>
          <FieldHint id={`${id}-medium-hint`}>How, like social, cpc or qr.</FieldHint>
        </div>
      </div>

      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">
          Dates <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`${id}-startsOn`} className="text-xs text-muted-foreground">
              Starts
            </Label>
            <DatePicker id={`${id}-startsOn`} value={form.startsOn} onValueChange={(value) => set("startsOn", value)} clearable placeholder="Any time" />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`${id}-endsOn`} className="text-xs text-muted-foreground">
              Ends
            </Label>
            <DatePicker
              id={`${id}-endsOn`}
              value={form.endsOn}
              onValueChange={(value) => set("endsOn", value)}
              min={form.startsOn || undefined}
              clearable
              placeholder="Ongoing"
              aria-invalid={shown("endsOn") ? true : undefined}
              aria-describedby={`${id}-endsOn-error`}
            />
          </div>
        </div>
        <FieldError id={`${id}-endsOn-error`}>{shown("endsOn")}</FieldError>
        <FieldHint>Leave both empty for an always-on campaign. Dates are in Asia/Bangkok time.</FieldHint>
      </fieldset>

      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor={`${id}-budget`}>
          Budget <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <NumberField {...field("budget")} prefix="฿" placeholder="Not set" value={form.budget} onChange={(event) => set("budget", event.target.value)} />
        <FieldError id={`${id}-budget-error`}>{shown("budget")}</FieldError>
        <FieldHint id={`${id}-budget-hint`}>For ads and printing. Coupons have their own discount budget.</FieldHint>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-notes`}>
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id={`${id}-notes`} rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="e.g. Boost runs until 15 Nov" />
      </div>

      {campaign ? (
        <>
          {spend?.(campaign)}
          <section aria-labelledby={`${id}-links`} className="grid gap-2">
            <div className="flex items-center gap-2">
              <h3 id={`${id}-links`} className="flex-1 text-base font-semibold text-foreground">
                Links <span className="text-sm font-normal tabular-nums text-muted-foreground">{countLabel(campaign.linkCount, campaign.countsCapped)}</span>
              </h3>
              <Link href={linksHref} className="text-xs font-semibold text-foreground underline-offset-2 hover:underline">
                Links & QR
              </Link>
            </div>
            {campaignLinks.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {campaignLinks.map((link) => (
                  <li key={link._id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <SlugChip path={link.shortUrlPath} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{link.name}</span>
                    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{link.opens.toLocaleString("en-US")} opens</span>
                    <StatusBadge {...LINK_STATUS[link.status]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No links yet. Add one in Links & QR and pick this campaign.</p>
            )}
          </section>
          <section aria-labelledby={`${id}-coupons`} className="grid gap-2">
            <h3 id={`${id}-coupons`} className="text-base font-semibold text-foreground">
              Coupons <span className="text-sm font-normal tabular-nums text-muted-foreground">{countLabel(campaign.couponCount, campaign.countsCapped)}</span>
            </h3>
            {campaignCoupons.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {campaignCoupons.map((coupon) => {
                  const state = couponState(coupon, today);
                  return (
                    <li key={coupon._id}>
                      <Link
                        href={couponHref(coupon._id)}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <CouponChip code={coupon.code} dim={state !== "active"} />
                        <span className="min-w-0 flex-1 text-muted-foreground">{benefitLabel(coupon.rules.benefit)}</span>
                        <StatusBadge {...COUPON_STATE[state]} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No coupon. Its links open with the direct offer only.</p>
            )}
          </section>
          {history?.(campaign._id)}
        </>
      ) : null}
    </SheetForm>
  );
}
