import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { affiliateSnapshot } from "./affiliateTypes";
import { bookingBalance, round2 } from "./billMath";
import { resortTodayIso } from "./dates";
import { orderPaymentRecord } from "./orderLifecycle";
import { adminEmails } from "./adminAuth";
import {
  ATTRIBUTION_WINDOW_MS,
  MAX_SESSIONS_READ,
  isVisitorKey,
  type MarketingCapture,
} from "./marketingAttribution";
export type AffiliateSnapshot = Infer<typeof affiliateSnapshot>;
const LIMIT = 500;
/** Frozen once, on booking creation / order settlement. Never reconstruct historical candidates. */
export async function captureAffiliateSnapshot(
  ctx: QueryCtx | MutationCtx,
  input: {
    linkId?: Id<"marketingLinks">;
    marketing?: MarketingCapture;
    couponId?: Id<"coupons">;
    propertySlug?: string;
    guestEmail?: string;
    staff: boolean;
  },
): Promise<AffiliateSnapshot> {
  const candidates: AffiliateSnapshot["candidates"] = [];
  const today = resortTodayIso();
  const coupon = input.couponId ? await ctx.db.get(input.couponId) : null;
  const eligibleReason = (partner: Doc<"marketingAffiliates">) => {
    if (partner.status !== "active") return "partner_inactive";
    if (
      (partner.startsOn && today < partner.startsOn) ||
      (partner.endsOn && today > partner.endsOn)
    )
      return "outside_dates";
    if (
      partner.propertySlugs?.length &&
      (!input.propertySlug ||
        !partner.propertySlugs.includes(input.propertySlug))
    )
      return "outside_scope";
    return undefined;
  };
  // Acquisition reporting and affiliate credit are separate: a later ordinary link does not erase
  // the latest eligible partner touch. Reads use the same 30-day window and 200-session bound.
  const linkIds = input.linkId ? [input.linkId] : [];
  if (isVisitorKey(input.marketing?.visitorKey)) {
    const now = Date.now();
    const sessions = await ctx.db
      .query("marketingSessions")
      .withIndex("by_visitorKey_and_startedAt", (q) =>
        q
          .eq("visitorKey", input.marketing!.visitorKey!)
          .gte("startedAt", now - ATTRIBUTION_WINDOW_MS)
          .lte("startedAt", now),
      )
      .order("desc")
      .take(MAX_SESSIONS_READ);
    for (const session of sessions)
      if (session.linkId && !linkIds.includes(session.linkId))
        linkIds.push(session.linkId);
  }
  let latestIneligible: AffiliateSnapshot["candidates"][number] | undefined;
  for (const linkId of linkIds) {
    const link = await ctx.db.get(linkId);
    const partner = link?.affiliateId
      ? await ctx.db.get(link.affiliateId)
      : null;
    if (!link || !partner) continue;
    const reason =
      eligibleReason(partner) ??
      (link.status !== "active" ? "link_inactive" : undefined);
    const candidate = {
      affiliateId: partner._id,
      name: partner.name,
      slug: partner.slug,
      origin: "link" as const,
      eligible: !reason,
      ...(reason ? { reason } : {}),
      ...(partner.contactEmail ? { contactEmail: partner.contactEmail } : {}),
      linkId: link._id,
    };
    if (!reason) {
      candidates.push(candidate);
      break;
    }
    latestIneligible ??= candidate;
  }
  if (!candidates.length && latestIneligible) candidates.push(latestIneligible);
  if (coupon?.affiliateId) {
    const partner = await ctx.db.get(coupon.affiliateId);
    if (partner) {
      const reason =
        eligibleReason(partner) ??
        (coupon.status !== "active" ? "coupon_inactive" : undefined);
      candidates.push({
        affiliateId: partner._id,
        name: partner.name,
        slug: partner.slug,
        origin: "coupon",
        eligible: !reason,
        ...(reason ? { reason } : {}),
        ...(partner.contactEmail ? { contactEmail: partner.contactEmail } : {}),
        couponId: coupon._id,
      });
    }
  }
  const chosen =
    candidates.find((c) => c.origin === "link" && c.eligible) ??
    candidates.find((c) => c.origin === "coupon" && c.eligible);
  const flags: string[] = [];
  if (new Set(candidates.map((c) => c.affiliateId)).size > 1)
    flags.push("affiliate_conflict");
  const email = input.guestEmail?.trim().toLowerCase();
  if (email && candidates.some((c) => c.contactEmail === email))
    flags.push("self_referral");
  if (input.staff || (email && adminEmails().has(email)))
    flags.push("staff_order");
  return {
    capturedAt: Date.now(),
    candidates,
    ...(chosen ? { affiliateId: chosen.affiliateId } : {}),
    flags,
  };
}
export async function creditMoney(
  ctx: QueryCtx | MutationCtx,
  credit: Pick<Doc<"affiliateCredits">, "bookingId" | "billId">,
) {
  if (credit.bookingId) {
    const row = await ctx.db.get(credit.bookingId);
    if (!row) return { eligible: false, net: 0 };
    const money = bookingBalance(row);
    return {
      eligible:
        row.currency === "THB" &&
        row.status !== "cancelled" &&
        row.paymentStatus === "paid" &&
        money.paid > 0,
      net: row.currency === "THB" ? Math.max(money.paid, 0) : 0,
    };
  }
  const row = credit.billId ? await ctx.db.get(credit.billId) : null;
  if (
    !row ||
    row.currency !== "THB" ||
    row.paidAt === undefined ||
    row.voidUnreceived
  )
    return { eligible: false, net: 0 };
  const [tenders, stays, refunds] = await Promise.all([
    ctx.db
      .query("billPayments")
      .withIndex("by_billId", (q) => q.eq("billId", row._id))
      .take(LIMIT + 1),
    ctx.db
      .query("bookingPayments")
      .withIndex("by_billId", (q) => q.eq("billId", row._id))
      .take(LIMIT + 1),
    ctx.db
      .query("appointmentRefunds")
      .withIndex("by_billId", (q) => q.eq("billId", row._id))
      .take(LIMIT + 1),
  ]);
  if ([tenders, stays, refunds].some((r) => r.length > LIMIT))
    throw new Error("Sale history exceeds the credit review limit");
  const gross = round2(
    orderPaymentRecord(row, tenders).tenders.reduce((s, p) => s + p.amount, 0) -
      stays
        .filter((p) => p.status === "recorded" && p.origin === "pos")
        .reduce((s, p) => s + p.amount, 0),
  );
  const refunded = refunds.reduce((s, r) => s + r.amount, 0);
  const net = Math.max(round2(gross - refunded), 0);
  // Zero-cash coupon service orders remain reporting activity; full refunds do not.
  const eligible =
    row.status === "paid" &&
    (net > 0 ||
      (gross === 0 && refunded === 0 && (row.promotion?.discount ?? 0) > 0));
  return { eligible, net };
}
export async function appendCreditChange(
  ctx: MutationCtx,
  row: Doc<"affiliateCredits">,
  actor: string,
  kind: string,
  reason?: string,
) {
  await ctx.db.insert("affiliateCreditChanges", {
    creditId: row._id,
    revision: row.revision,
    actor,
    kind,
    state: row.state,
    eligibleNet: row.eligibleNet,
    approvedNet: row.approvedNet,
    ...(row.affiliateId ? { affiliateId: row.affiliateId } : {}),
    ...(reason ? { reason } : {}),
    recordedAt: Date.now(),
  });
}
export async function syncAffiliateCredit(
  ctx: MutationCtx,
  source: { bookingId: Id<"bookings"> } | { billId: Id<"bills"> },
  actor = "system:affiliate",
  ineligibilityReason?: "payment_unlinked",
) {
  const bookingId = "bookingId" in source ? source.bookingId : undefined;
  const billId = "billId" in source ? source.billId : undefined;
  const sale = await ctx.db.get((bookingId ?? billId)!);
  const snapshot = sale?.affiliateSnapshot;
  if (!snapshot?.candidates.length) return null;
  const sourceKey = `${bookingId ? "booking" : "order"}:${bookingId ?? billId}`;
  const old = await ctx.db
    .query("affiliateCredits")
    .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
    .unique();
  const money = await creditMoney(ctx, { bookingId, billId });
  if (!old) {
    const id = await ctx.db.insert("affiliateCredits", {
      sourceKey,
      ...source,
      snapshot,
      ...(snapshot.affiliateId ? { affiliateId: snapshot.affiliateId } : {}),
      state: "pending",
      eligibleNet: money.net,
      approvedNet: 0,
      eligible: money.eligible,
      revision: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendCreditChange(ctx, (await ctx.db.get(id))!, actor, "created");
    return id;
  }
  // An explicit unlink moves cash back to the order, rather than refunding the sale.
  // Require a fresh review if the booking is paid again. Refunds, voids and cancellations
  // still reverse; retries, reassignment and partner status changes never reopen decisions.
  const requiresReview =
    ineligibilityReason === "payment_unlinked" &&
    bookingId !== undefined &&
    sale && "paymentStatus" in sale &&
    sale.status !== "cancelled" &&
    sale.paymentStatus !== "refunded" &&
    sale.paymentStatus !== "failed" &&
    (sale.amountRefunded ?? 0) === 0;
  let state = old.state;
  if (old.state === "approved" && !money.eligible)
    state = requiresReview ? "pending" : "reversed";
  const approvedNet = state === "approved" ? money.net : 0;
  if (
    old.eligibleNet === money.net &&
    old.eligible === money.eligible &&
    old.state === state &&
    old.approvedNet === approvedNet
  )
    return old._id;
  await ctx.db.patch(old._id, {
    state,
    eligible: money.eligible,
    eligibleNet: money.net,
    approvedNet,
    revision: old.revision + 1,
    updatedAt: Date.now(),
  });
  await appendCreditChange(
    ctx,
    (await ctx.db.get(old._id))!,
    actor,
    state !== old.state
      ? state === "pending" ? "review_required" : "reversed"
      : "amount_changed",
    state !== old.state && state === "pending"
      ? "Paid order row unlinked; a new review is required before approving this booking credit."
      : undefined,
  );
  return old._id;
}
