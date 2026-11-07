"use client";

import type { Id } from "convex/_generated/dataModel";
import { BedDouble, CalendarDays, CircleCheck, Home, Link2, Lock, MessageCircle, QrCode, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { locales } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { Callout, ChoiceGroup, CopyButton, CouponChip, FactList, FieldError, FieldHint } from "./MarketingBits";
import {
  COUPON_STATE,
  DESTINATION_KINDS,
  DESTINATION_LABELS,
  LINK_STATUS,
  benefitLabel,
  couponRulesLine,
  couponState,
  destinationLabel,
  localeLabel,
  normalizeSlugInput,
  shortUrl,
  slugCheckMessage,
} from "./marketing-format";
import type { CampaignRow, CouponRow, LinkDestination, LinkEntry, LinkRow, MarketingActions, MarketingProperty, SlugCheck } from "./types";

/** Starting values for a new link: a quick-start preset or a duplicate. */
export type LinkPreset = { name?: string; slug?: string; placement?: string; from?: LinkRow };

type Form = {
  name: string;
  slug: string;
  campaignId: string;
  placement: string;
  destKind: LinkDestination["kind"];
  villa: string;
  locale: string;
  couponId: string;
  entry: LinkEntry;
};

const AUTO_LOCALE = "auto";
const NO_COUPON = "none";
const ANY_VILLA = "any";

const DEST_ICONS = { home: Home, booking: CalendarDays, villa: BedDouble, experiences: Sparkles, chat: MessageCircle } as const;

function initialForm(link: LinkRow | undefined, preset: LinkPreset | undefined): Form {
  const source = link ?? preset?.from;
  const destination = source?.destination;
  return {
    name: link?.name ?? (preset?.from ? `${preset.from.name} (copy)` : (preset?.name ?? "")),
    slug: link?.slug ?? preset?.slug ?? "",
    campaignId: source?.campaignId ?? "",
    placement: source?.placement ?? preset?.placement ?? "",
    destKind: destination?.kind ?? "booking",
    villa: destination && (destination.kind === "villa" || destination.kind === "booking") ? (destination.propertySlug ?? "") : "",
    locale: source?.locale ?? AUTO_LOCALE,
    couponId: source?.couponId ?? NO_COUPON,
    entry: source?.entry ?? "link",
  };
}

function destinationOf(form: Form): LinkDestination {
  if (form.destKind === "villa") return { kind: "villa", propertySlug: form.villa };
  if (form.destKind === "booking") return form.villa ? { kind: "booking", propertySlug: form.villa } : { kind: "booking" };
  return { kind: form.destKind };
}

type SlugState = { status: "idle" } | { status: "checking"; slug: string } | { status: "done"; check: SlugCheck } | { status: "error"; message: string };

/** Live slug check: debounced, and an answer for an older value never overwrites a newer one. */
function useSlugCheck(slug: string, linkId: Id<"marketingLinks"> | undefined, skip: boolean, checkSlug: MarketingActions["checkSlug"]) {
  const [state, setState] = useState<SlugState>({ status: "idle" });
  const latest = useRef(slug);

  useEffect(() => {
    latest.current = slug;
    if (skip) {
      setState({ status: "idle" });
      return;
    }
    if (!slug) {
      setState({ status: "done", check: { ok: false, slug, reason: "empty" } });
      return;
    }
    setState({ status: "checking", slug });
    const timer = window.setTimeout(() => {
      checkSlug({ slug, linkId }).then(
        (check) => {
          if (latest.current === slug) setState({ status: "done", check });
        },
        (error: unknown) => {
          if (latest.current === slug) setState({ status: "error", message: errorText(error, "Couldn’t check this link. Try again.") });
        },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [slug, linkId, skip, checkSlug]);

  return state;
}

export function LinkEditor({
  link,
  preset,
  links,
  campaigns,
  coupons,
  properties,
  origin,
  today,
  campaignsHref,
  actions,
  onDone,
  onCancel,
  onDuplicate,
}: {
  link?: LinkRow;
  preset?: LinkPreset;
  links: LinkRow[];
  campaigns: CampaignRow[];
  coupons: CouponRow[];
  properties: MarketingProperty[];
  origin: string;
  today: string;
  campaignsHref: string;
  actions: Pick<MarketingActions, "saveLink" | "checkSlug">;
  onDone: (message: string) => void;
  onCancel: () => void;
  onDuplicate: (link: LinkRow) => void;
}) {
  const id = useId();
  const [form, setForm] = useState<Form>(() => initialForm(link, preset));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  // Once a link is live its address is printed and shared, so it can't change.
  const slugLocked = link !== undefined && link.status !== "draft";
  const unchangedSlug = link !== undefined && form.slug === link.slug;
  const slugState = useSlugCheck(form.slug, link?._id, slugLocked || unchangedSlug, actions.checkSlug);
  const slugOk = slugLocked || unchangedSlug || (slugState.status === "done" && slugState.check.ok);
  const takenBy = (slug: string) => links.find((other) => other.slug === slug && other._id !== link?._id)?.name;
  const slugMessage =
    slugState.status === "done" ? slugCheckMessage(slugState.check, takenBy(slugState.check.slug)) : slugState.status === "error" ? slugState.message : null;

  const liveCampaigns = campaigns.filter((campaign) => campaign.status !== "archived" || campaign._id === form.campaignId);
  const usableCoupons = coupons.filter((coupon) => coupon.status !== "archived" || coupon._id === form.couponId);
  const coupon = coupons.find((item) => item._id === form.couponId);
  const villaName = (slug: string) => properties.find((property) => property.slug === slug)?.name ?? slug;
  const url = shortUrl(origin, `/${form.slug || "…"}`);

  const errors = {
    name: form.name.trim() ? "" : "Give the link a name staff will recognise",
    slug: slugOk ? "" : (slugMessage ?? (slugState.status === "checking" ? "Still checking this link" : "Check the short link")),
    campaign: form.campaignId ? "" : "Choose a campaign",
    villa: form.destKind === "villa" && !form.villa ? "Choose the villa this link opens" : "",
  };
  const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find((key) => errors[key]);
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError("");
    if (firstError) {
      document.getElementById(`${id}-${firstError}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await actions.saveLink({
        linkId: link?._id,
        slug: link && slugLocked ? link.slug : form.slug,
        name: form.name.trim(),
        campaignId: form.campaignId as Id<"marketingCampaigns">,
        placement: form.placement.trim() || undefined,
        destination: destinationOf(form),
        locale: form.locale === AUTO_LOCALE ? undefined : form.locale,
        couponId: form.couponId === NO_COUPON ? undefined : (form.couponId as Id<"coupons">),
        entry: form.entry,
      });
      onDone(link ? `Saved /${link.slug}` : `Created /${form.slug}`);
    } catch (error) {
      setSaveError(errorText(error, "Couldn’t save the link."));
      setSaving(false);
    }
  }

  const couponLive = coupon ? couponState(coupon, today) : null;

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>Display name</Label>
            <Input
              id={`${id}-name`}
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="e.g. Facebook · November post"
              autoComplete="off"
              aria-invalid={show("name") ? true : undefined}
              aria-describedby={`${id}-name-hint ${id}-name-error`}
            />
            <FieldError id={`${id}-name-error`}>{show("name")}</FieldError>
            <FieldHint id={`${id}-name-hint`}>Only staff see this. Rename it any time; results stay with the link.</FieldHint>
          </div>

          {slugLocked && link ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium leading-none text-foreground">Short link</span>
              <div className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-muted-foreground">
                <Lock aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{shortUrl(origin, link.shortUrlPath).display}</span>
                <span className="text-xs font-semibold">Locked</span>
              </div>
              <div className="grid justify-items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="text-muted-foreground">
                  Published links keep their address, so shared posts and printed QR codes keep working. Need a different one? Make a copy.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate(link)}>
                  Duplicate as a new link
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-slug`}>Short link</Label>
              <div
                className={cn(
                  "flex h-10 min-w-0 overflow-hidden rounded-lg border border-input bg-background shadow-sm transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring pointer-coarse:min-h-11",
                  show("slug") && "border-destructive",
                )}
              >
                <span className="flex max-w-[55%] shrink-0 items-center truncate border-r border-border bg-muted/60 px-3 text-sm text-muted-foreground">
                  {shortUrl(origin, "/").display}
                </span>
                <input
                  id={`${id}-slug`}
                  value={form.slug}
                  onChange={(event) => set("slug", normalizeSlugInput(event.target.value))}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="f2"
                  aria-invalid={show("slug") || (slugMessage && form.slug) ? true : undefined}
                  aria-describedby={`${id}-slug-msg`}
                  className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-foreground outline-none max-md:text-base"
                />
              </div>
              <div id={`${id}-slug-msg`} aria-live="polite" className="min-h-4 text-xs">
                {slugState.status === "checking" ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Spinner label="Checking" className="size-3.5" />
                    Checking…
                  </span>
                ) : slugOk && form.slug && !unchangedSlug ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                    <CircleCheck aria-hidden className="size-3.5" />
                    {url.display} is free
                  </span>
                ) : slugMessage && (form.slug || submitted) ? (
                  <span className="font-medium text-destructive">{slugMessage}</span>
                ) : (
                  <span className="text-muted-foreground">Short and easy to type, like f2 or spa-week. It can’t change after publishing.</span>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-campaign`}>Campaign</Label>
              <Select value={form.campaignId} onValueChange={(value) => set("campaignId", value)}>
                <SelectTrigger
                  id={`${id}-campaign`}
                  className="h-10 w-full"
                  aria-invalid={show("campaign") ? true : undefined}
                  aria-describedby={`${id}-campaign-error`}
                >
                  <SelectValue placeholder="Choose a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {liveCampaigns.map((campaign) => (
                    <SelectItem key={campaign._id} value={campaign._id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id={`${id}-campaign-error`}>{show("campaign")}</FieldError>
              {liveCampaigns.length === 0 ? (
                <FieldHint>
                  No campaigns yet.{" "}
                  <Link href={campaignsHref} className="font-semibold text-foreground underline-offset-2 hover:underline">
                    Create one first
                  </Link>
                  .
                </FieldHint>
              ) : (
                <FieldHint>Sets the source and medium the visit reports as.</FieldHint>
              )}
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-placement`}>
                Placement <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id={`${id}-placement`}
                value={form.placement}
                onChange={(event) => set("placement", event.target.value)}
                placeholder="e.g. Pinned post, Lamai café poster"
                autoComplete="off"
              />
              <FieldHint>Where it’s shared. Only staff see this.</FieldHint>
            </div>
          </div>

          <div className="grid gap-3">
            <ChoiceGroup
              name={`${id}-dest`}
              label="Opens"
              value={form.destKind}
              onChange={(value) => set("destKind", value)}
              columns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              options={DESTINATION_KINDS.map((kind) => ({ value: kind, icon: DEST_ICONS[kind], ...DESTINATION_LABELS[kind] }))}
            />
            {form.destKind === "villa" || form.destKind === "booking" ? (
              <div className="grid gap-2">
                <Label htmlFor={`${id}-villa`} className="text-xs text-muted-foreground">
                  {form.destKind === "villa" ? "Villa" : "Villa to preselect (optional)"}
                </Label>
                <Select value={form.villa || ANY_VILLA} onValueChange={(value) => set("villa", value === ANY_VILLA ? "" : value)}>
                  <SelectTrigger
                    id={`${id}-villa`}
                    className="h-10 w-full"
                    aria-invalid={show("villa") ? true : undefined}
                    aria-describedby={`${id}-villa-error`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_VILLA}>{form.destKind === "villa" ? "Choose a villa" : "Any villa"}</SelectItem>
                    {properties.map((property) => (
                      <SelectItem key={property._id} value={property.slug}>
                        {property.name}
                        {property.status !== "active" ? ` · ${property.status === "draft" ? "draft" : "archived"}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id={`${id}-villa-error`}>{show("villa")}</FieldError>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-locale`}>Language</Label>
              <Select value={form.locale} onValueChange={(value) => set("locale", value)}>
                <SelectTrigger id={`${id}-locale`} className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_LOCALE}>Guest’s language</SelectItem>
                  {locales.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {localeLabel(locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>Pick one only for a post written in that language.</FieldHint>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-coupon`}>
                Coupon <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Select value={form.couponId} onValueChange={(value) => set("couponId", value)}>
                <SelectTrigger id={`${id}-coupon`} className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COUPON}>No coupon</SelectItem>
                  {usableCoupons.map((item) => (
                    <SelectItem key={item._id} value={item._id}>
                      <span className="font-mono">{item.code}</span> · {benefitLabel(item.rules.benefit)}
                      {couponState(item, today) !== "active" ? ` · ${COUPON_STATE[couponState(item, today)].label.toLowerCase()}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>Suggested on the booking page. Guests still get the better of it or the direct offer.</FieldHint>
            </div>
          </div>
          {coupon && couponLive && couponLive !== "active" ? (
            <Callout tone="warning" title={`${coupon.code} is ${COUPON_STATE[couponLive].label.toLowerCase()}`}>
              The link still works, but guests won’t see this offer until the coupon is live again.
            </Callout>
          ) : null}

          <ChoiceGroup
            name={`${id}-entry`}
            label="Entry"
            value={form.entry}
            onChange={(value) => set("entry", value)}
            options={[
              { value: "link", label: "Digital link", hint: "For posts, bios and messages", icon: Link2 },
              { value: "qr", label: "QR offer card", hint: "Printed or posted as an image", icon: QrCode },
            ]}
          />

          <section aria-label="Preview" aria-live="polite" className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-2">
              <p className="admin-eyebrow">Preview</p>
              {link ? <StatusBadge {...LINK_STATUS[link.status]} className="ms-auto" /> : null}
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 break-all font-mono text-base font-semibold text-foreground">{url.display}</span>
              {form.slug ? <CopyButton text={url.full} label={`Copy ${url.display}`} /> : null}
            </div>
            <FactList
              rows={[
                ["Opens", destinationLabel(destinationOf(form), villaName) + (form.locale !== AUTO_LOCALE ? ` · ${localeLabel(form.locale)}` : "")],
                [
                  "Offer",
                  coupon ? (
                    <span className="grid justify-items-start gap-1">
                      <CouponChip code={coupon.code} dim={couponLive !== "active"} />
                      <span className="text-xs text-muted-foreground">
                        {benefitLabel(coupon.rules.benefit)} · {couponRulesLine(coupon.rules)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No coupon. Website stays keep the direct offer.</span>
                  ),
                ],
                [
                  "Entry",
                  form.entry === "qr" ? "QR card. The code opens this short link; nothing else is added." : "Digital link",
                ],
              ]}
            />
          </section>
        </div>
      </div>

      <div className="grid gap-2 border-t border-border px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        {saveError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {saveError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
            {saving ? <Spinner label="Saving" className="text-current" /> : null}
            {link ? "Save changes" : "Create link"}
          </Button>
        </div>
      </div>
    </form>
  );
}
