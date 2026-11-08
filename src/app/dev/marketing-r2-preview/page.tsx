// TEMPORARY — DELETE BEFORE MERGE. Visual QA harness for marketing release 2a (coupon UI).
import { notFound } from "next/navigation";
import { MarketingR2Preview } from "./MarketingR2Preview";

/** Dev-only. Not linked anywhere; 404 outside `next dev`. */
export default function MarketingR2PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <MarketingR2Preview />;
}
