"use client";

import type { Id } from "convex/_generated/dataModel";
import { Send } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { CampaignPicker } from "./CampaignPicker";
import { FieldError } from "./MarketingBits";
import { QrCardBody } from "./QrCardDialog";
import { marketingErrorText, normalizeSlugInput, shortUrl, slugCheckMessage } from "./marketing-format";
import type { CampaignOption, CouponDetail, LinkDestination, LinkRow, MarketingActions, MarketingProperty } from "./types";

export type CouponQrActions = Pick<MarketingActions, "saveLink" | "setLinkStatus" | "checkSlug" | "saveCampaign">;

/** The link a coupon's QR card uses: a live QR link first, then any live link, then a draft. */
export function couponCardLink(links: readonly LinkRow[]): LinkRow | undefined {
  const rank = (link: LinkRow) => (link.status === "active" ? 0 : link.status === "draft" ? 2 : 9) + (link.entry === "qr" ? 0 : 1);
  return [...links].filter((link) => link.status === "active" || link.status === "draft").sort((a, b) => rank(a) - rank(b))[0];
}

/** Villa coupons open the booking page, spa coupons the experiences page. */
function destinationFor(coupon: CouponDetail): LinkDestination {
  return coupon.rules.scope === "services" ? { kind: "experiences" } : { kind: "booking" };
}

/**
 * The QR card from the coupon page. When the coupon has no link yet, it asks for the campaign and
 * short link, then saves the link and publishes it (two existing mutations, publish only after the
 * save) and shows the card with Print.
 */
export function CouponQrDialog({
  open,
  onClose,
  coupon,
  campaigns,
  properties,
  origin,
  brand,
  today,
  actions,
  canCreateCampaign,
}: {
  open: boolean;
  onClose: () => void;
  coupon: CouponDetail;
  campaigns: CampaignOption[];
  properties: MarketingProperty[];
  origin: string;
  brand: string;
  today: string;
  actions: CouponQrActions;
  canCreateCampaign: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-w-5xl flex-col gap-0 overflow-hidden p-0">
        {open ? (
          <CouponQrBody
            coupon={coupon}
            campaigns={campaigns}
            properties={properties}
            origin={origin}
            brand={brand}
            today={today}
            actions={actions}
            canCreateCampaign={canCreateCampaign}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CouponQrBody({
  coupon,
  campaigns,
  properties,
  origin,
  brand,
  today,
  actions,
  canCreateCampaign,
}: {
  coupon: CouponDetail;
  campaigns: CampaignOption[];
  properties: MarketingProperty[];
  origin: string;
  brand: string;
  today: string;
  actions: CouponQrActions;
  canCreateCampaign: boolean;
}) {
  const id = useId();
  const [createdId, setCreatedId] = useState<Id<"marketingLinks"> | null>(null);
  const [error, setError] = useState("");
  const link = createdId ? coupon.links.find((item) => item._id === createdId) : couponCardLink(coupon.links);

  async function publish(target: LinkRow) {
    setError("");
    try {
      await actions.setLinkStatus({ linkId: target._id, status: "active" });
    } catch (cause) {
      setError(marketingErrorText(cause, "Couldn’t publish the link."));
    }
  }

  if (createdId && !link) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner label="Making the card" />
        Making the card…
      </div>
    );
  }
  if (link) {
    return (
      <>
        {error ? (
          <p role="alert" className="border-b border-border px-5 py-3 pe-12 text-sm font-medium text-destructive sm:px-6">
            {error}
          </p>
        ) : null}
        <QrCardBody link={link} coupons={[coupon]} properties={properties} origin={origin} brand={brand} today={today} onPublish={(target) => void publish(target)} />
      </>
    );
  }
  return (
    <CardSetup
      id={id}
      coupon={coupon}
      campaigns={campaigns}
      origin={origin}
      actions={actions}
      canCreateCampaign={canCreateCampaign}
      onCreated={(linkId, publishError) => {
        setCreatedId(linkId);
        setError(publishError);
      }}
    />
  );
}

function CardSetup({
  id,
  coupon,
  campaigns,
  origin,
  actions,
  canCreateCampaign,
  onCreated,
}: {
  id: string;
  coupon: CouponDetail;
  campaigns: CampaignOption[];
  origin: string;
  actions: CouponQrActions;
  canCreateCampaign: boolean;
  onCreated: (linkId: Id<"marketingLinks">, publishError: string) => void;
}) {
  const couponCampaign = campaigns.find((campaign) => campaign._id === coupon.campaignId && campaign.status !== "archived");
  const [campaignId, setCampaignId] = useState<string>(couponCampaign?._id ?? "");
  const [slug, setSlug] = useState(() => normalizeSlugInput(coupon.code));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const { checkSlug } = actions;

  const campaignError = submitted && !campaignId ? "Choose a campaign" : "";
  const slugError = submitted && !slug ? "Add a short link" : "";

  async function create() {
    setSubmitted(true);
    if (!campaignId || !slug) return;
    setBusy(true);
    setError("");
    try {
      let linkId: Id<"marketingLinks">;
      let savedSlug: string;
      try {
        let check = await checkSlug({ slug });
        // The suggested short link is the code; when that's taken, code-qr. A typed one is kept as typed.
        if (!check.ok && check.reason === "taken" && !slugEdited) {
          const fallback = await checkSlug({ slug: `${slug}-qr` });
          if (fallback.ok) {
            check = fallback;
            setSlug(fallback.slug);
          }
        }
        if (!check.ok) {
          setError(slugCheckMessage(check) ?? "Choose a different short link");
          return;
        }
        savedSlug = check.slug;
        linkId = await actions.saveLink({
          slug: check.slug,
          name: `${coupon.code} QR card`,
          campaignId: campaignId as Id<"marketingCampaigns">,
          destination: destinationFor(coupon),
          couponId: coupon._id,
          entry: "qr",
        });
      } catch (cause) {
        setError(marketingErrorText(cause, "Couldn’t make the link."));
        return;
      }
      // Publish only once the link is saved. If it fails, the card opens on the draft with its Publish button.
      let publishError = "";
      try {
        await actions.setLinkStatus({ linkId, status: "active" });
      } catch (cause) {
        publishError = `Saved /${savedSlug} as a draft, but it isn’t live. ${marketingErrorText(cause, "Publishing failed.")}`;
      }
      onCreated(linkId, publishError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-4 pe-12 sm:px-6">
        <DialogTitle>QR card for {coupon.code}</DialogTitle>
        <DialogDescription>Pick where the card reports, then print it</DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="grid gap-4 p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor={`${id}-campaign`}>Campaign</Label>
          <CampaignPicker
            id={`${id}-campaign`}
            value={campaignId}
            onChange={setCampaignId}
            campaigns={campaigns}
            onCreate={canCreateCampaign ? actions.saveCampaign : undefined}
            defaults={{ name: `${coupon.code} print`, source: "print", medium: "qr" }}
            invalid={!!campaignError}
            describedBy={`${id}-campaign-error`}
          />
          <FieldError id={`${id}-campaign-error`}>{campaignError}</FieldError>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-slug`}>Short link</Label>
          <div className="flex h-10 min-w-0 overflow-hidden rounded-lg border border-input bg-background shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
            <span className="flex max-w-[55%] shrink-0 items-center truncate border-r border-border bg-muted/60 px-3 text-sm text-muted-foreground">{shortUrl(origin, "/").display}</span>
            <input
              id={`${id}-slug`}
              value={slug}
              onChange={(event) => {
                setSlug(normalizeSlugInput(event.target.value));
                setSlugEdited(true);
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={slugError ? true : undefined}
              aria-describedby={`${id}-slug-error`}
              className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-foreground outline-none max-md:text-base"
            />
          </div>
          <FieldError id={`${id}-slug-error`}>{slugError}</FieldError>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy} className="justify-self-start">
          {busy ? <Spinner label="Publishing" className="text-current" /> : <Send aria-hidden className="size-4" />}
          Publish the card
        </Button>
      </form>
    </>
  );
}
