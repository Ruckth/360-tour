import type { Doc } from '../_generated/dataModel';
import { type QueryCtx } from '../auth/model';
import { withMarketingReasonPrivacy, withoutPartnerPersonalData } from '../lib/marketingPrivacy';
import type { CreditRow } from '../shared/marketingAffiliateTypes';

export const LIMIT = 200;

export const AFFILIATE_LIMIT = 50;

export const SUMMARY_LIMIT = 50;

export async function creditRow(
  ctx: QueryCtx,
  row: Doc<"affiliateCredits">,
  fullDetail: boolean,
): Promise<CreditRow> {
  const booking = row.bookingId ? await ctx.db.get(row.bookingId) : null;
  const order = row.orderId ? await ctx.db.get(row.orderId) : null;
  const partner = row.affiliateId ? await ctx.db.get(row.affiliateId) : null;
  const candidates = fullDetail ? row.snapshot.candidates : row.snapshot.candidates.map(withoutPartnerPersonalData);
  return {
    ...withMarketingReasonPrivacy(row, fullDetail),
    snapshot: { ...row.snapshot, candidates },
    label: !fullDetail ? "Guest" :
      booking?.guestName ??
      order?.customerSnapshot?.name ??
      "Walk-in",
    ref:
      (!fullDetail && booking ? "Booking" : booking?.confirmationCode) ??
      (order ? `Order #${order.orderNumber}` : "Booking"),
    candidates,
    flags: row.snapshot.flags,
    affiliateName: partner?.name ?? null,
  };
}
