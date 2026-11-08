import { format } from "date-fns";
import type { MarketingAttribution } from "convex/lib/marketingAttribution";

const EVIDENCE: Record<MarketingAttribution["evidence"], string> = {
  tracked: "Tracked visit",
  current_link: "Link in this visit only",
};

/** Release 3a: which of our links brought a web or web-chat booking. Nothing when it has no snapshot. */
export function BookingMarketingSource({ attribution }: { attribution: MarketingAttribution | null }) {
  if (!attribution) return null;
  const { last, first, evidence } = attribution;
  const details = last ? [last.campaignName, last.placement].filter(Boolean).join(" · ") : "";
  const when = last?.touchedAt ? format(new Date(last.touchedAt), "d MMM yyyy, HH:mm") : "";
  return (
    <span className="mt-1.5 block" data-testid="booking-marketing-source">
      {last ? (
        <span className="block">
          <span className="font-mono">/{last.slug}</span> · {last.source} / {last.medium}
        </span>
      ) : (
        <span className="block">No link in the last 30 days</span>
      )}
      {details ? <span className="block text-muted-foreground">{details}</span> : null}
      <span className="block text-muted-foreground">{[when, EVIDENCE[evidence]].filter(Boolean).join(" · ")}</span>
      {first && last && first.linkId !== last.linkId ? (
        <span className="block text-muted-foreground">
          First seen via <span className="font-mono">/{first.slug}</span>
        </span>
      ) : null}
    </span>
  );
}
