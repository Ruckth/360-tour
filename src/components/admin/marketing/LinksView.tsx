"use client";

import type { Id } from "convex/_generated/dataModel";
import { Archive, CopyPlus, Facebook, Instagram, Link2, MapPin, MessageCircle, Pause, Pencil, Play, Plus, QrCode, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedTabs } from "../SegmentedTabs";
import { StatusBadge } from "../StatusBadge";
import { EmptyState, SearchBox } from "../admin-bulk";
import { LinkEditor, type LinkPreset } from "./LinkEditor";
import { Callout, CopyButton, CouponChip, EditorSheet, NoticeBar, RowMenu, SlugChip, countTabs, useConfirmedChange, useEditorSheet, useNotice, type RowAction } from "./MarketingBits";
import { QrCardDialog } from "./QrCardDialog";
import { COUPON_STATE, LINK_STATUS, benefitLabel, couponState, destinationLabel, shortUrl } from "./marketing-format";
import type { CampaignRow, CouponRow, LinkRow, LinkStatus, MarketingActions, MarketingProperty } from "./types";

type Tab = "all" | LinkStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

const QUICK_STARTS = [
  { name: "Facebook page", slug: "f", hint: "Page button and pinned posts", icon: Facebook },
  { name: "Google Maps", slug: "m", hint: "Business profile website link", icon: MapPin },
  { name: "Instagram bio", slug: "ig", hint: "The one link in your profile", icon: Instagram },
  { name: "LINE official account", slug: "l", hint: "Rich menu or broadcasts", icon: MessageCircle },
] as const;

const ALL_CAMPAIGNS = "all";

type LinksViewProps = {
  /** `undefined` while loading. */
  links?: LinkRow[];
  campaigns?: CampaignRow[];
  coupons?: CouponRow[];
  properties?: MarketingProperty[];
  /** Site origin the short links live on, e.g. https://book.auralis.example. */
  origin: string;
  brand: string;
  /** YYYY-MM-DD in Asia/Bangkok. */
  today: string;
  campaignsHref: string;
  actions: Pick<MarketingActions, "saveLink" | "setLinkStatus" | "checkSlug">;
};

export function LinksView({ links, campaigns, coupons, properties, origin, brand, today, campaignsHref, actions }: LinksViewProps) {
  const { notice, show, clear } = useNotice();
  const { pending, run } = useConfirmedChange<Id<"marketingLinks">>(show);
  const sheet = useEditorSheet<{ link?: LinkRow; preset?: LinkPreset }>();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = useState<string>(ALL_CAMPAIGNS);
  const [offerIssuesOnly, setOfferIssuesOnly] = useState(false);
  const [qrLink, setQrLink] = useState<LinkRow | null>(null);

  const loading = links === undefined || campaigns === undefined || coupons === undefined || properties === undefined;
  const couponOf = (link: LinkRow) => coupons?.find((coupon) => coupon._id === link.couponId);
  const campaignOf = (link: LinkRow) => campaigns?.find((campaign) => campaign._id === link.campaignId);
  const villaName = (slug: string) => properties?.find((property) => property.slug === slug)?.name ?? slug;
  // Live links whose coupon guests can no longer use: the visit still works, the offer is gone.
  const offerIssue = (link: LinkRow) => {
    const coupon = couponOf(link);
    return link.status === "active" && coupon !== undefined && couponState(coupon, today) !== "active";
  };

  const all = links ?? [];
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((link) => tab === "all" || link.status === tab)
    .filter((link) => campaignFilter === ALL_CAMPAIGNS || link.campaignId === campaignFilter)
    .filter((link) => !offerIssuesOnly || offerIssue(link))
    .filter((link) => !q || [link.slug, link.shortUrlPath, link.name, link.campaignName, link.couponCode ?? "", link.placement ?? ""].join(" ").toLowerCase().includes(q));
  const issues = all.filter(offerIssue);
  const filtered = tab !== "all" || q !== "" || campaignFilter !== ALL_CAMPAIGNS || offerIssuesOnly;

  function clearFilters() {
    setTab("all");
    setQuery("");
    setCampaignFilter(ALL_CAMPAIGNS);
    setOfferIssuesOnly(false);
  }

  const openNew = (preset?: LinkPreset) => sheet.open({ preset });
  const openEdit = (link: LinkRow) => sheet.open({ link });
  // The open QR card follows the live row, so publishing from it unlocks the downloads.
  const qrCurrent = qrLink ? (all.find((link) => link._id === qrLink._id) ?? qrLink) : null;

  function changeStatus(link: LinkRow, status: LinkStatus) {
    const url = shortUrl(origin, link.shortUrlPath).display;
    const destination = destinationLabel(link.destination, villaName).toLowerCase();
    const copy: Record<LinkStatus, { title: string; description: string; confirmLabel: string; done: string; destructive?: boolean }> = {
      active: {
        title: link.status === "draft" ? `Publish ${link.shortUrlPath}?` : `Resume ${link.shortUrlPath}?`,
        description:
          link.status === "draft"
            ? `${url} goes live and starts counting opens. Its address can’t change after this.`
            : `${url} shows its offer again${link.couponCode ? ` (${link.couponCode})` : ""}.`,
        confirmLabel: link.status === "draft" ? "Publish" : "Resume",
        done: link.status === "draft" ? `Published ${link.shortUrlPath}` : `Resumed ${link.shortUrlPath}`,
      },
      paused: {
        title: `Pause ${link.shortUrlPath}?`,
        description: `The link keeps working and opens ${destination}, without the offer. Resume it any time.`,
        confirmLabel: "Pause link",
        done: `Paused ${link.shortUrlPath}`,
      },
      archived: {
        title: `Archive ${link.shortUrlPath}?`,
        description: `It leaves the active list and can’t be edited. Anyone with the link still reaches ${destination}, without the offer. Results stay in reports.`,
        confirmLabel: "Archive link",
        done: `Archived ${link.shortUrlPath}`,
        destructive: true,
      },
      draft: { title: "", description: "", confirmLabel: "", done: "" },
    };
    const text = copy[status];
    return run(
      link._id,
      { title: text.title, description: text.description, confirmLabel: text.confirmLabel, destructive: text.destructive },
      () => actions.setLinkStatus({ linkId: link._id, status }),
      text.done,
      "Couldn’t change the link.",
    );
  }

  function rowActions(link: LinkRow): RowAction[] {
    const busy = pending === link._id;
    const list: RowAction[] = [];
    if (link.status !== "archived") list.push({ label: "Edit", icon: Pencil, onSelect: () => openEdit(link) });
    list.push({ label: "Duplicate", icon: CopyPlus, onSelect: () => openNew({ from: link }) });
    if (link.status === "draft") list.push({ label: "Publish", icon: Send, onSelect: () => void changeStatus(link, "active"), disabled: busy });
    if (link.status === "active") list.push({ label: "Pause", icon: Pause, onSelect: () => void changeStatus(link, "paused"), disabled: busy });
    if (link.status === "paused") list.push({ label: "Resume", icon: Play, onSelect: () => void changeStatus(link, "active"), disabled: busy });
    if (link.status !== "archived") list.push({ label: "Archive", icon: Archive, onSelect: () => void changeStatus(link, "archived"), destructive: true, disabled: busy });
    return list;
  }

  const counts = (value: Tab) => (value === "all" ? all.length : all.filter((link) => link.status === value).length);

  const { editing } = sheet;
  const editorSheet = (
    <EditorSheet
      open={editing !== null}
      onClose={() => void sheet.close()}
      wide
      header={
        <>
          <SheetTitle>{editing?.link ? `Edit ${editing.link.shortUrlPath}` : "New link"}</SheetTitle>
          <SheetDescription>
            {editing?.link ? "Changes apply to everyone who opens the link from now on." : "It starts counting opens as soon as it’s live."}
          </SheetDescription>
        </>
      }
    >
      {editing && campaigns && coupons && properties ? (
        <LinkEditor
          key={editing.key}
          link={editing.link}
          preset={editing.preset}
          links={all}
          campaigns={campaigns}
          coupons={coupons}
          properties={properties}
          origin={origin}
          today={today}
          campaignsHref={campaignsHref}
          actions={actions}
          onDone={(message) => {
            sheet.done();
            show(message);
          }}
          onCancel={() => void sheet.close()}
          onDirtyChange={sheet.setDirty}
          onDuplicate={(link) => openNew({ from: link })}
        />
      ) : null}
    </EditorSheet>
  );

  if (!loading && all.length === 0) {
    return (
      <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-4 px-4 py-4 sm:px-6">
        <NoticeBar notice={notice} onClose={clear} />
        <FirstRun origin={origin} onNew={openNew} />
        {editorSheet}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-60 flex-1 text-sm text-muted-foreground">
          One short link for each place you share. It records where guests came from and can suggest a coupon. Published links never change
          address, so printed QR codes keep working.
        </p>
        <Button size="sm" onClick={() => openNew()} className="w-full sm:w-auto">
          <Plus aria-hidden className="size-4" />
          New link
        </Button>
      </div>

      {issues.length > 0 && !offerIssuesOnly ? (
        <Callout
          tone="warning"
          role="alert"
          title={`${issues.length === 1 ? "1 live link suggests" : `${issues.length} live links suggest`} an offer guests can’t use`}
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setOfferIssuesOnly(true)}>
              Show {issues.length === 1 ? "it" : `the ${issues.length} links`}
            </Button>
          }
        >
          {issues.map((link) => link.shortUrlPath).join(", ")} open as usual, but the coupon isn’t live, so guests see no discount. Attach a new
          coupon or pause {issues.length === 1 ? "it" : "them"}.
        </Callout>
      ) : null}

      <div className="grid min-w-0 gap-3">
        <SegmentedTabs
          label="Link status"
          controls="marketing-links-list"
          value={tab}
          onValueChange={setTab}
          tabs={countTabs(TABS.map(({ value, label }) => ({ value, label, n: loading ? undefined : counts(value) })))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} label="Search links, campaigns, codes" />
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="h-9 w-full rounded-lg sm:w-56" aria-label="Campaign">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CAMPAIGNS}>All campaigns</SelectItem>
              {(campaigns ?? []).map((campaign) => (
                <SelectItem key={campaign._id} value={campaign._id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {offerIssuesOnly ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setOfferIssuesOnly(false)}>
              Show all links
            </Button>
          ) : null}
          <p role="status" className="w-full text-xs text-muted-foreground sm:ms-auto sm:w-auto">
            {loading ? "Loading links…" : shown.length === all.length ? `${all.length} links` : `${shown.length} of ${all.length} links`}
          </p>
        </div>
      </div>

      <section id="marketing-links-list" aria-label="Links" aria-busy={loading} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <NoticeBar notice={notice} onClose={clear} />
        {loading ? (
          <LinksSkeleton />
        ) : shown.length === 0 ? (
          <EmptyState
            action={
              filtered ? (
                <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          >
            No links match these filters.
          </EmptyState>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="admin-eyebrow border-b border-border bg-muted/40">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Link
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Campaign · source
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Coupon
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Entry
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
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
                  {shown.map((link) => {
                    const url = shortUrl(origin, link.shortUrlPath);
                    const campaign = campaignOf(link);
                    return (
                      <tr key={link._id} className="border-b border-border align-top transition-colors last:border-b-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <SlugChip path={link.shortUrlPath} />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => (link.status === "archived" ? setQrLink(link) : openEdit(link))}
                                className="max-w-full rounded-sm text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {link.name}
                              </button>
                              <div className="flex min-w-0 items-center gap-0.5">
                                <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{url.display}</span>
                                <CopyButton text={url.full} label={`Copy ${url.display}`} className="size-7 [&_svg]:size-3.5" />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-foreground">{link.campaignName}</p>
                          {campaign ? (
                            <p className="mt-0.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                              {campaign.source} · {campaign.medium}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <CouponCell link={link} coupon={couponOf(link)} today={today} />
                        </td>
                        <td className="px-4 py-3">
                          <EntryLabel link={link} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge {...LINK_STATUS[link.status]} />
                          <StatusNote link={link} />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{link.opens.toLocaleString("en-US")}</td>
                        <td className="py-2.5 pe-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {link.status !== "archived" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-9 text-muted-foreground hover:text-foreground"
                                aria-label={`QR offer card for ${link.shortUrlPath}`}
                                title="QR offer card"
                                onClick={() => setQrLink(link)}
                              >
                                <QrCode aria-hidden className="size-4" />
                              </Button>
                            ) : null}
                            <RowMenu label={`More actions for ${link.shortUrlPath}`} actions={rowActions(link)} className="size-9" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 md:p-4 lg:hidden">
              {shown.map((link) => {
                const url = shortUrl(origin, link.shortUrlPath);
                const campaign = campaignOf(link);
                return (
                  <li key={link._id} className="grid min-w-0 grid-cols-1 content-start gap-3 p-4 md:rounded-lg md:border md:border-border md:bg-background/60">
                    <div className="flex items-start gap-3">
                      <SlugChip path={link.shortUrlPath} large />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{link.name}</p>
                        <p className="break-all font-mono text-xs text-muted-foreground">{url.display}</p>
                      </div>
                      <StatusBadge {...LINK_STATUS[link.status]} />
                    </div>
                    <dl className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-xs">
                      <dt className="text-muted-foreground">Campaign</dt>
                      <dd className="min-w-0 text-foreground">{link.campaignName}</dd>
                      {campaign ? (
                        <>
                          <dt className="text-muted-foreground">Source</dt>
                          <dd className="min-w-0 font-mono text-foreground">
                            {campaign.source} · {campaign.medium}
                          </dd>
                        </>
                      ) : null}
                      <dt className="pt-0.5 text-muted-foreground">Coupon</dt>
                      <dd className="min-w-0">
                        <CouponCell link={link} coupon={couponOf(link)} today={today} />
                      </dd>
                      <dt className="text-muted-foreground">Entry</dt>
                      <dd className="min-w-0">
                        <EntryLabel link={link} />
                      </dd>
                    </dl>
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
                      <span>
                        <span className="font-semibold tabular-nums text-foreground">{link.opens.toLocaleString("en-US")}</span>{" "}
                        <span className="text-muted-foreground">opens</span>
                      </span>
                      <StatusNote link={link} inline />
                    </div>
                    <div className="flex gap-2">
                      <CopyButton text={url.full} label={`Copy ${url.display}`} showLabel variant="outline" className="flex-1" />
                      {link.status !== "archived" ? (
                        <Button type="button" variant="outline" className="flex-1" onClick={() => setQrLink(link)}>
                          <QrCode aria-hidden className="size-4" />
                          QR card
                        </Button>
                      ) : null}
                      <RowMenu label={`More actions for ${link.shortUrlPath}`} actions={rowActions(link)} className="border border-border" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {loading ? null : (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Opens count every visit to a short link, bots excluded. A link reports where it was placed, not where it travelled: a Facebook link
            pasted into LINE still counts as Facebook.
          </p>
        )}
      </section>

      {editorSheet}
      <QrCardDialog
        link={qrCurrent}
        coupons={coupons ?? []}
        properties={properties ?? []}
        origin={origin}
        brand={brand}
        today={today}
        onClose={() => setQrLink(null)}
        onPublish={(link) => void changeStatus(link, "active")}
      />
    </div>
  );
}


function CouponCell({ link, coupon, today }: { link: LinkRow; coupon?: CouponRow; today: string }) {
  if (!link.couponCode && !coupon) return <span className="text-muted-foreground">None</span>;
  const code = coupon?.code ?? link.couponCode ?? "";
  const state = coupon ? couponState(coupon, today) : null;
  const live = state === "active";
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      <CouponChip code={code} dim={!live} />
      {coupon && live ? <p className="text-xs text-muted-foreground">{benefitLabel(coupon.rules.benefit)}</p> : null}
      {state && !live ? (
        link.status === "active" ? (
          <p className="flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            {COUPON_STATE[state].label}, guests see no discount
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{COUPON_STATE[state].label}</p>
        )
      ) : null}
    </div>
  );
}

function EntryLabel({ link }: { link: LinkRow }) {
  const Icon = link.entry === "qr" ? QrCode : Link2;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-foreground">
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      {link.entry === "qr" ? "QR card" : "Link"}
    </span>
  );
}

function StatusNote({ link, inline = false }: { link: LinkRow; inline?: boolean }) {
  const note =
    link.status === "paused" ? "Opens without the offer" : link.status === "draft" ? "Not live yet" : link.status === "archived" ? "Kept for reports" : null;
  if (!note) return null;
  return <span className={inline ? "text-xs text-muted-foreground" : "mt-1 block text-xs text-muted-foreground"}>{note}</span>;
}

function LinksSkeleton() {
  return (
    <div role="status" className="divide-y divide-border">
      <span className="sr-only">Loading links</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="h-8 w-11 rounded-md" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function FirstRun({ origin, onNew }: { origin: string; onNew: (preset?: LinkPreset) => void }) {
  const host = shortUrl(origin, "/").display;
  return (
    <section aria-labelledby="links-first-run" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="mx-auto grid max-w-2xl justify-items-center gap-5 px-5 py-10 text-center sm:px-8 sm:py-14">
        <span className="flex size-12 items-center justify-center rounded-full bg-gold/15 text-gold-text">
          <QrCode aria-hidden className="size-6" />
        </span>
        <div className="grid gap-2">
          <h2 id="links-first-run" className="text-lg font-semibold leading-tight text-foreground">
            Make your first short link
          </h2>
          <p className="text-sm text-muted-foreground">
            Give each place you share its own link, like <span className="font-mono text-foreground">{host}f</span> for your Facebook page. You’ll
            see which places bring guests, and you can turn any link into a QR offer card.
          </p>
        </div>
        <div className="grid w-full gap-2 text-left sm:grid-cols-2" aria-label="Quick start">
          {QUICK_STARTS.map(({ name, slug, hint, icon: Icon }) => (
            <button
              key={slug}
              type="button"
              onClick={() => onNew({ name, slug })}
              className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{name}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
              <span className="font-mono text-xs font-semibold text-foreground">/{slug}</span>
            </button>
          ))}
        </div>
        <Button type="button" onClick={() => onNew()}>
          <Plus aria-hidden className="size-4" />
          New link
        </Button>
      </div>
    </section>
  );
}
