// TEMPORARY — delete this whole folder (src/app/dev/marketing-preview) before shipping.
// Marketing R1 QA harness: the real admin views on in-memory sample data from
// docs/previews/marketing/kit/data.md, so they can be checked at 390/820/1180/1440 in both
// themes while convex/marketing.ts is still stubbed. Not linked anywhere; 404 outside `next dev`.
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MarketingPreview } from "./MarketingPreview";

export default function MarketingPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense fallback={null}>
      <MarketingPreview />
    </Suspense>
  );
}
