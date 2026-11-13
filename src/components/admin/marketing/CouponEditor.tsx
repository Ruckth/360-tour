"use client";

import type { Id } from "convex/_generated/dataModel";
import { normalizeCouponCode } from "convex/lib/offers";
import { Archive, ArrowLeft, Lock, Pause, Play, QrCode, Send, Wand2 } from "lucide-react";
import { canEditMarketing, useMarketingAccess } from "./MarketingAccess";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useConfirm } from "../ConfirmDialog";
import { StatusBadge } from "../StatusBadge";
import { Callout, ChoiceGroup, FieldError, FieldHint, NoticeBar, NumberField, SlugChip, SideCard, UsageBar, useConfirmedChange, useNotice, type Notice } from "./MarketingBits";
import { CouponLedger } from "./CouponLedger";
import { CouponQrDialog, couponCardLink, type CouponQrActions } from "./CouponQrDialog";
import { TestQuotePanel } from "./TestQuotePanel";
import { EMPTY_COUPON_FORM, couponFormErrors, couponFormFrom, couponFormKey, couponRulesFrom, rulesChanged, type CouponForm, type CouponFormErrors } from "./coupon-form";
import {
  COUPON_STATE,
  LINK_STATUS,
  benefitLabel,
  couponRulesLine,
  couponState,
  formatRange,
  formatStamp,
  generatedTerms,
  marketingErrorText,
  scopeLabel,
  thb,
  usageWithHeld,
} from "./marketing-format";
import type { CampaignRow, CouponDetail, CouponRow, CouponStatus, MarketingActions, MarketingProperty } from "./types";

const NO_CAMPAIGN = "none";

type CouponEditorProps = {
  /** New coupon, or an existing one: `undefined` while loading, `null` when it doesn't exist. */
  detail?: CouponDetail | null;
  isNew: boolean;
  coupons?: CouponRow[];
  campaigns?: CampaignRow[];
  properties?: MarketingProperty[];
  today: string;
  listHref: string;
  /** Where short links live, and the name printed on the QR card. */
  origin: string;
  brand: string;
  actions: Pick<MarketingActions, "saveCoupon" | "setCouponStatus" | "testQuote"> & CouponQrActions;
  /** After the first save of a new coupon, e.g. to move to its page. */
  onCreated: (couponId: Id<"coupons">) => void;
  /** Renders the change history of a saved coupon (MarketingScreens passes RecordHistoryPanel). */
  history?: (couponId: Id<"coupons">) => ReactNode;
  /** Renders a saved coupon's refusal counts (MarketingScreens passes CouponRefusalsCard). */
  refusals?: (couponId: Id<"coupons">) => ReactNode;
};

/**
 * What the first save said, kept for the coupon's own page: `onCreated` moves there, and the
 * builder is mounted again for the saved coupon.
 */
const savedNotices = new Map<string, Notice>();

export function CouponEditor({ detail, isNew, coupons, campaigns, properties, today, listHref, origin, brand, actions, onCreated, history, refusals }: CouponEditorProps) {
  const { capabilities } = useMarketingAccess();
  if (isNew && !capabilities.draft) return <div className="mx-auto max-w-3xl p-6"><h2 className="text-xl font-semibold">Creating coupons requires draft access</h2><ButtonLink href={listHref} variant="outline" className="mt-3">Back to coupons</ButtonLink></div>;
  if (!isNew && detail === undefined) return <EditorSkeleton />;
  if (!isNew && detail === null) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
        <section className="grid justify-items-center gap-3 border border-border bg-card px-4 py-12 text-center">
          <p className="text-base font-semibold text-foreground">Coupon not found</p>
          <p className="max-w-md text-sm text-muted-foreground">It may have been removed, or the address is wrong.</p>
          <ButtonLink href={listHref} size="sm" variant="outline">
            Back to coupons
          </ButtonLink>
        </section>
      </div>
    );
  }
  if (!campaigns || !properties || !coupons) return <EditorSkeleton />;
  return (
    <CouponBuilder
      key={detail?._id ?? "new"}
      detail={detail ?? undefined}
      coupons={coupons}
      campaigns={campaigns}
      properties={properties}
      today={today}
      listHref={listHref}
      origin={origin}
      brand={brand}
      actions={actions}
      onCreated={onCreated}
      history={history}
      refusals={refusals}
    />
  );
}

function EditorSkeleton() {
  return (
    <div role="status" className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6">
      <span className="sr-only">Loading coupon</span>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}

/** A sub-heading inside the coupon card or More rules: no box of its own. */
function Group({ title, children, id, aside }: { title: string; children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-3">
      <div className="flex items-center gap-3">
        <h4 id={id} className="flex-1 text-sm font-semibold text-foreground">
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STATUS_ACTIONS: Record<CouponStatus, { status: CouponStatus; label: string; icon: typeof Send; destructive?: boolean }[]> = {
  draft: [
    { status: "active", label: "Publish", icon: Send },
    { status: "archived", label: "Archive", icon: Archive, destructive: true },
  ],
  active: [
    { status: "paused", label: "Pause", icon: Pause },
    { status: "archived", label: "Archive", icon: Archive, destructive: true },
  ],
  paused: [
    { status: "active", label: "Resume", icon: Play },
    { status: "archived", label: "Archive", icon: Archive, destructive: true },
  ],
  archived: [],
};

/** Fields folded into "More rules"; an error in one opens it. */
const MORE_RULE_KEYS: readonly (keyof CouponFormErrors)[] = ["maxSaving", "bookTo", "stayTo", "minNights", "minSubtotal", "usageLimit", "budget"];

/** True when a saved coupon uses any rule kept under "More rules", so its page opens them. */
function usesMoreRules(form: CouponForm) {
  return Boolean(
    form.campaignId || form.maxSaving || form.bookFrom || form.bookTo || form.stayFrom || form.stayTo || form.minNights || form.minSubtotal || form.usageLimit || form.budget || form.terms,
  );
}

function CouponBuilder({
  detail,
  coupons,
  campaigns,
  properties,
  today,
  listHref,
  origin,
  brand,
  actions,
  onCreated,
  history,
  refusals,
}: {
  detail?: CouponDetail;
  coupons: CouponRow[];
  campaigns: CampaignRow[];
  properties: MarketingProperty[];
  today: string;
  listHref: string;
  origin: string;
  brand: string;
  actions: CouponEditorProps["actions"];
  onCreated: CouponEditorProps["onCreated"];
  history?: CouponEditorProps["history"];
  refusals?: CouponEditorProps["refusals"];
}) {
  const access = useMarketingAccess();
  const canEdit = canEditMarketing(access, detail);
  const canPublish = access.capabilities.publish;
  const id = useId();
  const router = useRouter();
  const confirm = useConfirm();
  const { notice, show, clear } = useNotice();
  const baseline = detail ? couponFormFrom(detail) : EMPTY_COUPON_FORM;
  const [form, setForm] = useState<CouponForm>(baseline);
  const [moreOpen, setMoreOpen] = useState(() => usesMoreRules(baseline));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const { pending: statusPending, run } = useConfirmedChange<Id<"coupons">>(show);
  const statusBusy = statusPending !== null;
  const set = <K extends keyof CouponForm>(key: K, value: CouponForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  // The first save of a new coupon reports here, on the coupon's own page.
  useEffect(() => {
    const saved = detail ? savedNotices.get(detail._id) : undefined;
    if (!saved || !detail) return;
    savedNotices.delete(detail._id);
    show(saved.text, saved.tone);
  }, [detail, show]);

  const archived = detail?.status === "archived";
  const codeLocked = (detail?.used ?? 0) > 0;
  const takenCodes = coupons.filter((coupon) => coupon._id !== detail?._id).map((coupon) => coupon.code);
  const errors: CouponFormErrors = couponFormErrors(form, { takenCodes, used: detail?.used });
  const firstError = (Object.keys(errors) as (keyof CouponFormErrors)[])[0];
  const shown = (key: keyof CouponFormErrors) => (submitted ? errors[key] : undefined);
  const rules = couponRulesFrom(form);
  const code = normalizeCouponCode(form.code);
  const changedRules = detail ? rulesChanged(rules, detail.rules) : true;
  // Compared on what would be saved, so formatting ("1500" vs "1,500"), villa order or spaces aren't edits.
  const dirty = couponFormKey(form) !== couponFormKey(baseline);
  const nextVersion = (detail?.currentVersion ?? 0) + 1;
  const villaName = (slug: string) => properties.find((property) => property.slug === slug)?.name ?? slug;
  const state = detail ? couponState(detail, today) : null;
  const liveCampaigns = campaigns.filter((campaign) => campaign.status !== "archived" || campaign._id === form.campaignId);
  // The QR card needs a published coupon, and either a live link or the rights to make one.
  const cardLink = detail ? couponCardLink(detail.links) : undefined;
  const canQr = detail?.status === "active" && (cardLink?.status === "active" || (access.capabilities.draft && canPublish));

  // A new coupon has no version yet, so it says nothing about versions until it is saved.
  const saveHint = !canEdit ? "Read-only for your Marketing role" : !detail
    ? ""
    : !dirty
      ? "No changes"
      : changedRules
        ? `Saving creates version ${nextVersion}`
        : "Saving keeps version " + detail.currentVersion;

  function focusError(key: keyof CouponFormErrors) {
    if (MORE_RULE_KEYS.includes(key)) setMoreOpen(true);
    // After the disclosure has opened.
    window.requestAnimationFrame(() => document.getElementById(`${id}-${key}`)?.focus());
  }

  /** Saves the form; with "publish" it confirms first, then publishes only after the save succeeded. */
  async function save(intent: "save" | "publish") {
    if (!canEdit) return;
    setSubmitted(true);
    if (firstError) {
      focusError(firstError);
      return;
    }
    if (
      intent === "publish" &&
      !(await confirm({ title: `Publish ${code}?`, description: "Guests can use it from now on, within its dates and limits.", confirmLabel: "Save & publish" }))
    )
      return;
    setSaving(true);
    const campaignId = form.campaignId ? (form.campaignId as Id<"marketingCampaigns">) : undefined;
    let result: Awaited<ReturnType<typeof actions.saveCoupon>>;
    try {
      result = await actions.saveCoupon({ couponId: detail?._id, code, campaignId, ...rules });
    } catch (error) {
      show(marketingErrorText(error, "Couldn’t save the coupon."), "danger");
      setSaving(false);
      return;
    }
    setSubmitted(false);
    // Show what was stored (normalised code, sorted villas, trimmed terms, formatted numbers).
    setForm(couponFormFrom({ code, campaignId, rules }));
    let saved: Notice = { tone: "success", text: detail ? (changedRules ? `Saved version ${result.version}` : "Saved") : `Saved ${code} as a draft` };
    if (intent === "publish") {
      try {
        await actions.setCouponStatus({ couponId: result.couponId, status: "active" });
        saved = { tone: "success", text: `${code} is live` };
      } catch (error) {
        saved = { tone: "danger", text: `Saved ${code} as a draft, but it isn’t live. ${marketingErrorText(error, "Publishing failed.")}` };
      }
    }
    setSaving(false);
    if (!detail) {
      savedNotices.set(result.couponId, saved);
      onCreated(result.couponId);
    } else show(saved.text, saved.tone);
  }

  async function changeStatus(status: CouponStatus) {
    if (!detail || !canPublish) return;
    const copy: Record<CouponStatus, { title: string; description: string; label: string; done: string }> = {
      active: {
        title: detail.status === "draft" ? `Publish ${detail.code}?` : `Resume ${detail.code}?`,
        description:
          detail.status === "draft"
            ? "Guests can use it from now on, within its dates and limits. Links that suggest it start showing the offer."
            : "Guests can use it again, within its dates and limits.",
        label: detail.status === "draft" ? "Publish" : "Resume",
        done: detail.status === "draft" ? `${detail.code} is live` : `${detail.code} resumed`,
      },
      paused: {
        title: `Pause ${detail.code}?`,
        description: "New quotes stop using it. Links that suggest it keep working, without the offer.",
        label: "Pause coupon",
        done: `${detail.code} paused`,
      },
      archived: {
        title: `Archive ${detail.code}?`,
        description: "It can’t be used or edited again. Its versions and history stay.",
        label: "Archive coupon",
        done: `${detail.code} archived`,
      },
      draft: { title: "", description: "", label: "", done: "" },
    };
    const text = copy[status];
    if (dirty && status === "active" && !(await confirm({ title: "Save your changes first?", description: "Publishing uses the saved version. Your unsaved edits stay in the form.", confirmLabel: "Publish saved version" }))) return;
    await run(
      detail._id,
      { title: text.title, description: text.description, confirmLabel: text.label, destructive: status === "archived" },
      () => actions.setCouponStatus({ couponId: detail._id, status }),
      text.done,
      "Couldn’t change the coupon.",
    );
  }

  // Reloading or closing the tab with unsaved edits asks first (the back link has its own confirm).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function leave(event: MouseEvent) {
    if (!dirty) return;
    event.preventDefault();
    if (await confirm({ title: "Discard your changes?", description: "Edits that aren’t saved are lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", destructive: true })) {
      router.push(listHref);
    }
  }

  const field = (key: keyof CouponFormErrors) => ({
    id: `${id}-${key}`,
    "aria-invalid": shown(key) ? true : undefined,
    "aria-describedby": `${id}-${key}-error ${id}-${key}-hint`,
  });
  const err = (key: keyof CouponFormErrors) => <FieldError id={`${id}-${key}-error`}>{shown(key)}</FieldError>;
  const disabled = archived || !canEdit;

  const spinner = saving ? <Spinner label="Saving" className="text-current" /> : null;
  // One primary action: Save & publish for a new coupon, QR card for a live one with nothing to save.
  const headerActions = () =>
    !detail ? (
      !canEdit ? null : canPublish ? (
        <>
          <Button type="button" size="sm" disabled={saving} onClick={() => void save("publish")}>
            {spinner}
            Save &amp; publish
          </Button>
          <MoreMenu label="More save options" disabled={saving} items={[{ label: "Save as draft", onSelect: () => void save("save") }]} />
        </>
      ) : (
        <Button type="submit" form={`${id}-form`} size="sm" disabled={saving}>
          {spinner}
          Save draft
        </Button>
      )
    ) : (
      <>
        {canQr ? (
          <Button type="button" size="sm" variant={dirty ? "outline" : "default"} onClick={() => setQrOpen(true)}>
            <QrCode aria-hidden className="size-4" />
            QR card
          </Button>
        ) : null}
        {canEdit ? (
          <Button type="submit" form={`${id}-form`} size="sm" variant={canQr && !dirty ? "outline" : "default"} disabled={saving || archived || !dirty}>
            {spinner}
            Save
          </Button>
        ) : null}
      </>
    );

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-4 pb-24 sm:px-6 sm:pb-4" data-coupon-editor="">
      <ButtonLink href={listHref} variant="ghost" size="sm" className="-ml-2" onClick={(event) => void leave(event)}>
        <ArrowLeft aria-hidden className="size-4" />
        Coupons
      </ButtonLink>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 break-all font-mono text-2xl font-semibold tracking-tight text-foreground">{detail ? detail.code : "New coupon"}</h2>
        {state ? <StatusBadge {...COUPON_STATE[state]} /> : null}
        {detail ? <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground">v{detail.currentVersion}</span> : null}
        <div className="ms-auto hidden items-center gap-2 sm:flex">
          {saveHint ? (
            <span className="me-1 text-xs text-muted-foreground" aria-live="polite">
              {saveHint}
            </span>
          ) : null}
          {headerActions()}
        </div>
      </div>

      <div className="mt-3">
        <NoticeBar notice={notice} onClose={clear} />
      </div>
      {archived ? (
        <Callout className="mt-3" title="This coupon is archived">
          It can’t be used or edited. Its versions stay for reports.
        </Callout>
      ) : null}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          id={`${id}-form`}
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void save(!detail && canPublish ? "publish" : "save");
          }}
          className="grid min-w-0 gap-4"
        >
          <fieldset disabled={disabled} className="grid min-w-0 gap-5 border border-border bg-card p-4">
            <legend className="sr-only">Coupon</legend>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,10rem)] sm:items-start">
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-code`}>Code</Label>
                {codeLocked ? (
                  <div className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-muted-foreground">
                    <Lock aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-foreground">{detail?.code}</span>
                    <span className="text-xs font-semibold">Locked</span>
                  </div>
                ) : (
                  <Input
                    {...field("code")}
                    value={form.code}
                    onChange={(event) => set("code", event.target.value.toUpperCase().replace(/\s+/g, "-"))}
                    placeholder="e.g. SUMMER15"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="font-mono font-semibold tracking-wide"
                  />
                )}
                {codeLocked ? (
                  <FieldHint id={`${id}-code-hint`}>
                    Used {detail?.used} {detail?.used === 1 ? "time" : "times"}, so the code can’t change.
                  </FieldHint>
                ) : (
                  err("code")
                )}
              </div>
              <div className="grid content-start gap-2">
                <span id={`${id}-kind`} className="text-sm font-medium leading-none text-foreground">
                  Type
                </span>
                <ToggleGroup aria-labelledby={`${id}-kind`} value={form.kind} onValueChange={(value) => set("kind", value)} disabled={disabled}>
                  <ToggleGroupItem value="percent" className="flex-1 sm:min-w-20">
                    Percent
                  </ToggleGroupItem>
                  <ToggleGroupItem value="fixed" className="flex-1 sm:min-w-20">
                    Fixed ฿
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-value`}>Discount</Label>
                <NumberField
                  {...field("value")}
                  prefix={form.kind === "fixed" ? "฿" : undefined}
                  suffix={form.kind === "percent" ? "%" : undefined}
                  value={form.value}
                  onChange={(event) => set("value", event.target.value)}
                  className="font-semibold"
                />
                {err("value")}
              </div>
            </div>

            <ChoiceGroup
              name={`${id}-scope`}
              label="Covers"
              value={form.scope}
              onChange={(value) => set("scope", value)}
              columns="sm:grid-cols-3"
              options={[
                { value: "accommodation", label: "Accommodation", hint: "Villa nights" },
                { value: "services", label: "Spa services", hint: "Treatments, not extras" },
                { value: "accommodation_and_services", label: "Both", hint: "Villas and spa" },
              ]}
            />
            {form.scope !== "services" ? (
              <fieldset className="-mt-2 grid gap-3" aria-describedby={`${id}-villas-error`}>
                <legend className="sr-only">Villas</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  <label className="flex min-h-10 items-center gap-2">
                    <input type="radio" name={`${id}-all-villas`} checked={form.allVillas} onChange={() => set("allVillas", true)} className="size-4 accent-foreground" />
                    All villas
                  </label>
                  <label className="flex min-h-10 items-center gap-2">
                    <input type="radio" name={`${id}-all-villas`} checked={!form.allVillas} onChange={() => set("allVillas", false)} className="size-4 accent-foreground" />
                    Choose villas
                  </label>
                </div>
                {!form.allVillas ? (
                  <div id={`${id}-villas`} tabIndex={-1} className="grid gap-2 outline-none sm:grid-cols-2 xl:grid-cols-3">
                    {properties.map((property) => (
                      <label
                        key={property._id}
                        className="flex min-h-11 items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-foreground/40 has-[:checked]:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                      >
                        <input
                          type="checkbox"
                          checked={form.villas.includes(property.slug)}
                          onChange={(event) =>
                            set("villas", event.target.checked ? [...form.villas, property.slug] : form.villas.filter((slug) => slug !== property.slug))
                          }
                          className="mt-0.5 size-4 accent-foreground"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{property.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {thb(property.pricePerNight)} / night · up to {property.maxGuests}
                            {property.status !== "active" ? ` · ${property.status}` : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {err("villas")}
              </fieldset>
            ) : null}

            <details
              open={moreOpen}
              onToggle={(event) => setMoreOpen(event.currentTarget.open)}
              className="group border-t border-border pt-4"
            >
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="text-muted-foreground transition group-open:rotate-90">›</span>
                <span>More rules</span>
                <span className="font-normal text-muted-foreground">Campaign, dates, limits, terms</span>
              </summary>
              <div className="mt-4 grid gap-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <Label htmlFor={`${id}-campaign`}>Campaign</Label>
                    <Select value={form.campaignId || NO_CAMPAIGN} onValueChange={(value) => set("campaignId", value === NO_CAMPAIGN ? "" : value)} disabled={disabled}>
                      <SelectTrigger id={`${id}-campaign`} className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CAMPAIGN}>No campaign</SelectItem>
                        {liveCampaigns.map((campaign) => (
                          <SelectItem key={campaign._id} value={campaign._id}>
                            {campaign.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldHint>Groups it with the campaign’s links in reports</FieldHint>
                  </div>
                  {form.kind === "percent" ? (
                    <div className="grid content-start gap-2">
                      <Label htmlFor={`${id}-maxSaving`}>Max saving</Label>
                      <NumberField {...field("maxSaving")} prefix="฿" placeholder="No cap" value={form.maxSaving} onChange={(event) => set("maxSaving", event.target.value)} />
                      {err("maxSaving")}
                      <FieldHint id={`${id}-maxSaving-hint`}>Caps the discount on big bookings</FieldHint>
                    </div>
                  ) : null}
                </div>

                <Group id={`${id}-sec-dates`} title="Dates">
                  <div className="grid gap-4 md:grid-cols-2">
                    <DateWindow
                      legend="Booking window"
                      hint="When the booking or sale is made"
                      fromId={`${id}-bookFrom`}
                      toId={`${id}-bookTo`}
                      fromLabel="Opens"
                      toLabel="Closes"
                      from={form.bookFrom}
                      to={form.bookTo}
                      onFrom={(value) => set("bookFrom", value)}
                      onTo={(value) => set("bookTo", value)}
                      error={shown("bookTo")}
                      disabled={disabled}
                    />
                    <DateWindow
                      legend="Stay or treatment window"
                      hint="Every night or treatment falls inside"
                      fromId={`${id}-stayFrom`}
                      toId={`${id}-stayTo`}
                      fromLabel="From"
                      toLabel="Until"
                      from={form.stayFrom}
                      to={form.stayTo}
                      onFrom={(value) => set("stayFrom", value)}
                      onTo={(value) => set("stayTo", value)}
                      error={shown("stayTo")}
                      disabled={disabled}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Inclusive, Asia/Bangkok time · empty means no limit</p>
                </Group>

                <Group id={`${id}-sec-limits`} title="Minimums and limits">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid content-start gap-2">
                      <Label htmlFor={`${id}-minSubtotal`}>Minimum eligible spend</Label>
                      <NumberField {...field("minSubtotal")} prefix="฿" placeholder="None" value={form.minSubtotal} onChange={(event) => set("minSubtotal", event.target.value)} />
                      {err("minSubtotal")}
                      <FieldHint id={`${id}-minSubtotal-hint`}>Counts the covered items only</FieldHint>
                    </div>
                    {form.scope !== "services" ? (
                      <div className="grid content-start gap-2">
                        <Label htmlFor={`${id}-minNights`}>Minimum nights</Label>
                        <NumberField {...field("minNights")} placeholder="None" value={form.minNights} onChange={(event) => set("minNights", event.target.value)} />
                        {err("minNights")}
                        <FieldHint id={`${id}-minNights-hint`}>Shorter stays keep the direct offer</FieldHint>
                      </div>
                    ) : null}
                    <div className="grid content-start gap-2">
                      <Label htmlFor={`${id}-usageLimit`}>Total uses</Label>
                      <NumberField {...field("usageLimit")} placeholder="No limit" value={form.usageLimit} onChange={(event) => set("usageLimit", event.target.value)} />
                      {err("usageLimit")}
                      <FieldHint id={`${id}-usageLimit-hint`}>{detail ? `${detail.used.toLocaleString("en-US")} used so far` : "Paid bookings and sales"}</FieldHint>
                    </div>
                    <div className="grid content-start gap-2">
                      <Label htmlFor={`${id}-budget`}>Discount budget</Label>
                      <NumberField {...field("budget")} prefix="฿" placeholder="No budget" value={form.budget} onChange={(event) => set("budget", event.target.value)} />
                      {err("budget")}
                      <FieldHint id={`${id}-budget-hint`}>
                        {detail ? `${thb(detail.discountGranted)} given so far · ` : ""}New checkouts stop at this amount
                      </FieldHint>
                    </div>
                  </div>
                </Group>

                <Group
                  id={`${id}-sec-terms`}
                  title="Customer terms"
                  aside={
                    <Button type="button" variant="outline" size="sm" onClick={() => set("terms", generatedTerms(rules))}>
                      <Wand2 aria-hidden className="size-4" />
                      Write from rules
                    </Button>
                  }
                >
                  <Label htmlFor={`${id}-terms`} className="sr-only">
                    Customer terms
                  </Label>
                  <Textarea
                    id={`${id}-terms`}
                    rows={4}
                    value={form.terms}
                    onChange={(event) => set("terms", event.target.value)}
                    placeholder={generatedTerms(rules)}
                    className="leading-relaxed"
                  />
                  <FieldHint>Shown at checkout, on the QR card and receipts · empty uses the placeholder</FieldHint>
                </Group>
              </div>
            </details>
          </fieldset>
        </form>

        <aside className="grid min-w-0 gap-4" aria-label="Summary, status, test and history">
          <section aria-labelledby={`${id}-summary`} className="border border-border bg-card">
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h3 id={`${id}-summary`} className="flex-1 text-base font-semibold text-foreground">
                Summary
              </h3>
              {state ? <StatusBadge {...COUPON_STATE[state]} /> : <StatusBadge tone="neutral" label="Not saved" />}
            </header>
            <div className="grid gap-3 p-4">
              <div>
                <p className="break-all font-mono text-xl font-semibold tracking-wide text-foreground">{code || "—"}</p>
                <p className="mt-1 text-sm text-foreground">
                  {(rules.benefit.kind === "percent" ? rules.benefit.percent : rules.benefit.amount) > 0 ? benefitLabel(rules.benefit) : "Set the discount"}
                  {rules.benefit.kind === "percent" && rules.maxSaving ? `, up to ${thb(rules.maxSaving)}` : ""}
                </p>
              </div>
              <dl className="divide-y divide-border border-t border-border text-sm">
                {(
                  [
                    ["Covers", scopeLabel(rules.scope, rules.propertySlugs, villaName)],
                    ["Booking", formatRange(rules.bookFrom, rules.bookTo)],
                    ["Stay", formatRange(rules.stayFrom, rules.stayTo)],
                    ["Rules", couponRulesLine(rules)],
                  ] as const
                ).map(([term, value]) => (
                  <div key={term} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="min-w-0 break-words text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              {detail ? (
                <div className="grid gap-3 border-t border-border pt-3">
                  <div className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Uses</span>
                      <span className="tabular-nums text-foreground">{usageWithHeld(detail.used, detail.held ?? 0, detail.rules.usageLimit)}</span>
                    </div>
                    <UsageBar used={detail.used + (detail.held ?? 0)} limit={detail.rules.usageLimit} label="Uses, including held" />
                    {detail.held ? (
                      <p className="text-xs text-muted-foreground">
                        {detail.used.toLocaleString("en-US")} paid · {detail.held.toLocaleString("en-US")} held by unpaid bookings, back if they expire
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Discount given</span>
                      <span className="tabular-nums text-foreground">
                        {thb(detail.discountGranted)}
                        {detail.rules.discountBudget !== undefined ? ` / ${thb(detail.rules.discountBudget)}` : " · no budget"}
                      </span>
                    </div>
                    <UsageBar used={detail.discountGranted + (detail.heldDiscount ?? 0)} limit={detail.rules.discountBudget} label="Discount budget used, including held" />
                    {detail.heldDiscount ? <p className="text-xs text-muted-foreground">Plus {thb(detail.heldDiscount)} held by unpaid bookings</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {canPublish && detail && STATUS_ACTIONS[detail.status].length ? (
            <SideCard
              id={`${id}-status`}
              title="Status"
              description={detail.status === "draft" ? "Guests can’t use a draft yet" : detail.status === "paused" ? "Quotes ignore it until you resume" : "Guests can use it within its dates and limits"}
            >
              <div className="flex flex-wrap gap-2 p-4">
                {STATUS_ACTIONS[detail.status].map(({ status, label, icon: Icon, destructive }) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={status === "active" && detail.status === "draft" ? "default" : "outline"}
                    disabled={statusBusy}
                    className={cn("flex-1", destructive && "text-destructive")}
                    onClick={() => void changeStatus(status)}
                  >
                    <Icon aria-hidden className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </SideCard>
          ) : null}

          {/* A quote runs on saved rules, so the test appears once there are some. */}
          {detail ? (
            <TestQuotePanel code={detail.code} savedVersion={detail.currentVersion} dirty={dirty} properties={properties} today={today} testQuote={actions.testQuote} />
          ) : null}

          {detail ? <CouponLedger code={detail.code} redemptions={detail.redemptions} /> : null}

          {detail ? refusals?.(detail._id) : null}

          {detail ? (
            <SideCard id={`${id}-versions`} title="Versions" description="A rule change adds a version; old ones never change">
              <ol className="grid gap-2 p-4">
                {[...detail.versions]
                  .sort((a, b) => b.version - a.version)
                  .map((version) => (
                    <li key={version._id} className="grid gap-1 rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground">v{version.version}</span>
                        <span className="min-w-0 flex-1 font-medium text-foreground">{benefitLabel(version.benefit)}</span>
                        {version.version === detail.currentVersion ? <StatusBadge tone="success" label="Current" /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{couponRulesLine(version)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatStamp(version.createdAt)} · {version.createdByEmail}
                      </p>
                    </li>
                  ))}
              </ol>
            </SideCard>
          ) : null}

          {detail ? (
            <SideCard id={`${id}-links`} title="Links that suggest it">
              {detail.links.length ? (
                <ul className="divide-y divide-border">
                  {detail.links.map((link) => (
                    <li key={link._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <SlugChip path={link.shortUrlPath} />
                      <span className="min-w-0 flex-1 truncate text-foreground">{link.name}</span>
                      <StatusBadge {...LINK_STATUS[link.status]} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">None yet{canQr ? " · QR card makes one" : ""}</p>
              )}
            </SideCard>
          ) : null}

          {detail && history ? <div className="border border-border bg-card px-4 [&>details]:border-t-0">{history(detail._id)}</div> : null}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[var(--admin-tab-bar,0px)] z-20 flex items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:hidden">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="block truncate font-mono text-sm font-semibold text-foreground">{code || "New coupon"}</span>
          {saveHint ? <span aria-hidden>{saveHint}</span> : null}
        </p>
        {headerActions()}
      </div>

      {detail && canQr ? (
        <CouponQrDialog
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          coupon={detail}
          campaigns={campaigns}
          properties={properties}
          origin={origin}
          brand={brand}
          today={today}
          actions={actions}
          canCreateCampaign={access.capabilities.draft}
        />
      ) : null}
    </div>
  );
}

function DateWindow({
  legend,
  hint,
  fromId,
  toId,
  fromLabel,
  toLabel,
  from,
  to,
  onFrom,
  onTo,
  error,
  disabled,
}: {
  legend: string;
  hint: string;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid min-w-0 content-start gap-2">
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={fromId} className="text-xs text-muted-foreground">
            {fromLabel}
          </Label>
          <DatePicker id={fromId} value={from} onValueChange={onFrom} clearable placeholder="Any time" disabled={disabled} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={toId} className="text-xs text-muted-foreground">
            {toLabel}
          </Label>
          <DatePicker
            id={toId}
            value={to}
            onValueChange={onTo}
            min={from || undefined}
            clearable
            placeholder="No end"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${toId}-error`}
          />
        </div>
      </div>
      <FieldError id={`${toId}-error`}>{error}</FieldError>
      <FieldHint>{hint}</FieldHint>
    </fieldset>
  );
}
