"use client";

import { Download, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Callout, CouponChip } from "./MarketingBits";
import { COUPON_STATE, couponState, generatedTerms, offerExpiry, offerHeadline, qrDirectPercent, shortUrl } from "./marketing-format";
import { QR_CARD_FORMATS, buildQrCard, documentFonts, drawQrCard, qrCardSvg, type QrCardContent, type QrCardFormat } from "./qr-card";
import type { CouponRow, LinkRow, MarketingProperty } from "./types";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What the card says: the live coupon's offer, else the direct-booking offer. */
function qrCardContent({
  link,
  coupon,
  couponLive,
  origin,
  brand,
  directPercent,
}: {
  link: LinkRow;
  coupon?: CouponRow;
  couponLive: boolean;
  origin: string;
  brand: string;
  directPercent: number;
}): QrCardContent {
  const url = shortUrl(origin, link.shortUrlPath);
  const base = { url: url.full, displayUrl: url.display, brand, place: "Book direct on our website" };
  if (coupon && couponLive) {
    const { head, sub } = offerHeadline(coupon.rules.benefit, coupon.rules.scope);
    return {
      ...base,
      eyebrow: "Direct booking offer",
      head,
      sub,
      code: coupon.code,
      terms: coupon.rules.terms?.trim() || generatedTerms(coupon.rules),
      expiry: offerExpiry(coupon.rules),
    };
  }
  return directPercent > 0
    ? {
        ...base,
        eyebrow: "Book direct",
        head: `Save ${directPercent}%`,
        sub: "on villa stays, no code needed",
        terms: `${directPercent}% off accommodation booked on our website · Subject to availability`,
        expiry: "Direct-booking offer",
      }
    : { ...base, eyebrow: "Book direct", head: "Book direct", sub: "Our villas, best on our website", terms: "Subject to availability", expiry: "Scan to book" };
}

export function QrCardDialog({
  link,
  coupons,
  properties,
  origin,
  brand,
  today,
  onClose,
  onPublish,
}: {
  link: LinkRow | null;
  coupons: CouponRow[];
  properties: MarketingProperty[];
  origin: string;
  brand: string;
  today: string;
  onClose: () => void;
  /** Publishes a draft link from the card, so it can be downloaded. */
  onPublish?: (link: LinkRow) => void;
}) {
  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-5xl flex-col gap-0 overflow-hidden p-0">
        {link ? <QrCardBody link={link} coupons={coupons} properties={properties} origin={origin} brand={brand} today={today} onPublish={onPublish} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function QrCardBody({
  link,
  coupons,
  properties,
  origin,
  brand,
  today,
  onPublish,
}: {
  link: LinkRow;
  coupons: CouponRow[];
  properties: MarketingProperty[];
  origin: string;
  brand: string;
  today: string;
  onPublish?: (link: LinkRow) => void;
}) {
  const [format, setFormat] = useState<QrCardFormat>("square");
  const [busy, setBusy] = useState<"png" | "svg" | null>(null);
  const [error, setError] = useState("");
  const coupon = coupons.find((item) => item._id === link.couponId);
  const state = coupon ? couponState(coupon, today) : null;
  // The destination villa's own percent, or what every public villa gives (see qrDirectPercent).
  const directPercent = qrDirectPercent(link.destination, properties);
  // A draft isn't resolved yet: scanning it shows "page not found", so it can't be downloaded.
  const draft = link.status === "draft";
  const content = qrCardContent({ link, coupon, couponLive: state === "active", origin, brand, directPercent });
  const spec = buildQrCard(content, format);
  const svg = qrCardSvg(spec);
  const info = QR_CARD_FORMATS[format];
  const filename = `${link.slug.replace(/[^a-z0-9-]+/gi, "-")}-qr-${info.file}`;

  async function savePng() {
    setBusy("png");
    setError("");
    try {
      await document.fonts?.ready;
      const canvas = drawQrCard(spec, documentFonts());
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Couldn’t make the PNG.");
      download(blob, `${filename}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t make the PNG.");
    } finally {
      setBusy(null);
    }
  }

  function saveSvg() {
    setError("");
    download(new Blob([qrCardSvg(spec, { standalone: true })], { type: "image/svg+xml" }), `${filename}.svg`);
  }

  const portrait = format !== "square";
  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-4 pe-12 sm:px-6">
        <DialogTitle>QR offer card</DialogTitle>
        <DialogDescription>
          <span className="font-mono text-foreground">{link.shortUrlPath}</span> · {link.name}
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="grid justify-items-center gap-3 rounded-xl border border-border bg-muted/50 p-4 sm:p-6">
            <div
              className={cn("overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/10 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full", portrait ? "w-full max-w-[22rem]" : "w-full max-w-[32rem]")}
              // Built from escaped text by qrCardSvg, never from raw HTML.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="text-center text-xs text-muted-foreground">
              {info.size} · {info.use}
            </p>
          </div>

          <div className="grid content-start gap-5">
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium leading-none text-foreground">Format</legend>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1">
                {(Object.keys(QR_CARD_FORMATS) as QrCardFormat[]).map((key) => (
                  <label
                    key={key}
                    className="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  >
                    <input type="radio" name="qr-format" value={key} checked={format === key} onChange={() => setFormat(key)} className="sr-only" />
                    <span>{QR_CARD_FORMATS[key].label}</span>
                    <span className="font-normal opacity-80">{key === "a6" ? "105×148 mm" : `${QR_CARD_FORMATS[key].width}×${QR_CARD_FORMATS[key].height}`}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <dl className="grid gap-3 text-sm">
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">QR opens</dt>
                <dd className="break-all font-mono text-foreground">{content.url}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Code on the card</dt>
                <dd>{content.code ? <CouponChip code={content.code} /> : <span className="text-muted-foreground">None, the direct offer needs no code</span>}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Terms</dt>
                <dd className="text-muted-foreground">{content.terms}</dd>
              </div>
            </dl>

            {draft ? (
              <Callout
                tone="warning"
                title="This link is a draft"
                action={
                  onPublish ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onPublish(link)}>
                      <Send aria-hidden className="size-4" />
                      Publish
                    </Button>
                  ) : null
                }
              >
                Scanning it shows “page not found” until you publish it, so downloads are off for now.
              </Callout>
            ) : link.status === "paused" || link.status === "archived" ? (
              <Callout tone="warning" title={`This link is ${link.status}`}>
                Scanning it opens {link.destination.kind === "home" ? "the home page" : "the page"} without the offer.
              </Callout>
            ) : coupon && state !== "active" && state ? (
              <Callout tone="warning" title={`${coupon.code} is ${COUPON_STATE[state].label.toLowerCase()}`}>
                The card shows the direct offer instead. Attach a live coupon to advertise a different saving.
              </Callout>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => void savePng()} disabled={busy !== null || draft}>
                {busy === "png" ? <Spinner label="Making PNG" className="text-current" /> : <Download aria-hidden className="size-4" />}
                PNG
              </Button>
              <Button type="button" variant="outline" onClick={saveSvg} disabled={busy !== null || draft}>
                <Download aria-hidden className="size-4" />
                SVG
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">PNG for posting, SVG for print shops. The code carries no personal data.</p>
          </div>
        </div>
      </div>
    </>
  );
}
