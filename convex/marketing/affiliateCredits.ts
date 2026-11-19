import type { Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { adminEmails } from '../lib/adminEmails';
import { readBudget, ReadBudgetExceeded } from '../lib/readBudget';
import { affiliateSnapshot } from '../shared/affiliateTypes';
import { resortTodayIso } from '../shared/time';
import { MAX_ORDER_REFUNDS, bookingBalance, lineNet, roundMoney } from '../shared/orderMath';
import { excludesAffiliateCredit, projectTender } from '../shared/tenderProjection';
import { isCouponEligibleLine } from '../shared/posCoupons';
import { ATTRIBUTION_WINDOW_MS, MAX_SESSIONS_READ, isVisitorKey, type MarketingCapture } from '../shared/marketingAttribution';

export type AffiliateSnapshot = Infer<typeof affiliateSnapshot>;

const LIMIT = 500;

type CreditCtx = QueryCtx | MutationCtx;

async function creditSource<T extends 'bookings' | 'orders'>(ctx: CreditCtx, id: Id<T>) {
  const budget = readBudget(ctx);
  if (!budget.range()) throw new ReadBudgetExceeded();
  const row = await ctx.db.get(id);
  if (row && !budget.document(row)) throw new ReadBudgetExceeded();
  return row;
}

async function creditRows<T>(ctx: CreditCtx, query: AsyncIterable<T>, limit: number): Promise<T[]> {
  const budget = readBudget(ctx);
  if (!budget.range()) throw new ReadBudgetExceeded();
  const rows: T[] = [];
  for await (const row of query) {
    if (!budget.document(row)) throw new ReadBudgetExceeded();
    if (rows.length === limit) throw new Error("Sale history exceeds the credit review limit");
    rows.push(row);
  }
  return rows;
}

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
  const recordedLinkIds = new Set<Id<"marketingLinks">>();
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
    for (const session of sessions) {
      if (!session.linkId) continue;
      recordedLinkIds.add(session.linkId);
      if (!linkIds.includes(session.linkId)) linkIds.push(session.linkId);
    }
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
      // Anonymous raw opens cannot be tied to this guest. A matching server session can.
      evidence: recordedLinkIds.has(link._id) ? "recorded_session" as const : "claimed_slug" as const,
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
  const linkCandidate = candidates.find(c => c.origin === "link");
  // Flags are review warnings; a recorded visit is the normal case and stays on the candidate only.
  if (linkCandidate?.evidence === "claimed_slug") flags.push("referral_claimed_slug");
  return {
    capturedAt: Date.now(),
    candidates,
    ...(chosen ? { affiliateId: chosen.affiliateId } : {}),
    flags,
  };
}

function bookingCreditMoney(row: Doc<'bookings'> | null) {
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

async function orderCreditMoney(ctx: CreditCtx, row: Doc<'orders'> | null) {
  if (
    !row ||
    row.currency !== "THB" ||
    row.paidAt === undefined ||
    row.voidUnreceived
  )
    return { eligible: false, net: 0 };
  const [tenders, stays, refunds, posRefunds, lines] = await Promise.all([
    creditRows(ctx, ctx.db.query("orderPayments").withIndex("by_orderId", q => q.eq("orderId", row._id)), LIMIT),
    creditRows(ctx, ctx.db.query("bookingPayments").withIndex("by_orderId", q => q.eq("orderId", row._id)), LIMIT),
    creditRows(ctx, ctx.db.query("appointmentRefunds").withIndex("by_orderId", q => q.eq("orderId", row._id)), LIMIT),
    creditRows(ctx, ctx.db.query("orderRefunds").withIndex("by_orderId", q => q.eq("orderId", row._id)), MAX_ORDER_REFUNDS),
    row.vatVersion === 2
      ? creditRows(ctx, ctx.db.query("orderLines").withIndex("by_orderId", q => q.eq("orderId", row._id)), 100)
      : [],
  ]);
  const saleDate = row.paymentEffectiveAt ?? row.paidAt;
  const excluded = lines.filter(line => excludesAffiliateCredit(line.kind));
  const excludedIds = new Set(excluded.map(line => line._id));
  const excludedExternal = excluded.reduce((total, line) => {
    const external = line.saleSnapshot?.tenderCells.find(cell => cell.kind === 'external');
    return total + (external?.amount ?? (line.saleSnapshot ? 0 : lineNet(line)));
  }, 0);
  // Excluded POS rows' external mirrors supply their share of the payout rollup.
  const excludedPayouts = posRefunds.reduce((total, refund) =>
    refund.returnId && refund.method !== 'voucher' && excludedIds.has(refund.lineId)
      ? total + refund.amount
      : total, 0);
  const projection = projectTender({
    payments: (row.amendedTenders ?? tenders).map(p => ({ ...p, date: saleDate })),
    stayPayments: stays.filter(p => p.status === 'recorded' && p.origin === 'pos').map(p => ({ ...p, date: saleDate })),
    refunds: [
      ...refunds.map(refund => ({ ...refund, date: refund.effectiveAt })),
      ...posRefunds.filter(refund => !excludedIds.has(refund.lineId)).map(refund => ({ ...refund, date: refund.businessDate })),
    ],
    recordedPayoutTotal: Math.max((row.returnedTotal ?? 0) - excludedPayouts, 0),
  });
  const gross = roundMoney(projection.collected - excludedExternal);
  const { refunded } = projection;
  const net = Math.max(roundMoney(gross - refunded), 0);
  // Zero-cash coupon service orders remain reporting activity; full refunds do not.
  const voucherApplied = tenders.some(tender => tender.method === 'voucher') ||
    lines.some(line => line.saleSnapshot?.goodwillDiscounts.some(discount => discount.amount > 0));
  const couponDiscount = row.vatVersion === 2
    ? lines.reduce((total, line) => total + (isCouponEligibleLine(line) ? line.couponDiscount ?? 0 : 0), 0)
    : row.promotion?.discount ?? 0;
  const eligible =
    row.status === "paid" &&
    (net > 0 ||
      (gross === 0 && refunded === 0 && !voucherApplied && couponDiscount > 0));
  return { eligible, net };
}

export async function creditMoney(
  ctx: CreditCtx,
  credit: Pick<Doc<"affiliateCredits">, "bookingId" | "orderId">,
) {
  if (credit.bookingId) return bookingCreditMoney(await creditSource(ctx, credit.bookingId));
  return orderCreditMoney(ctx, credit.orderId ? await creditSource(ctx, credit.orderId) : null);
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
  source: { bookingId: Id<"bookings"> } | { orderId: Id<"orders"> },
  actor = "system:affiliate",
  ineligibilityReason?: "payment_unlinked",
) {
  const booking = "bookingId" in source ? await ctx.db.get(source.bookingId) : null;
  const order = "orderId" in source ? await ctx.db.get(source.orderId) : null;
  const sale = booking ?? order;
  const snapshot = sale?.affiliateSnapshot;
  if (!snapshot?.candidates.length) return null;
  const sourceKey = "bookingId" in source ? `booking:${source.bookingId}` : `order:${source.orderId}`;
  const old = await ctx.db
    .query("affiliateCredits")
    .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
    .unique();
  const money = booking ? bookingCreditMoney(booking) : await orderCreditMoney(ctx, order);
  if (!old) {
    if (order?.vatVersion === 2 && !money.eligible && money.net === 0) return null;
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
  // Unlinks move existing cash; affected credits return to review.
  // Refunds and cancellations still reverse; retries and reassignment never reopen decisions.
  const unlinked =
    ineligibilityReason === "payment_unlinked" &&
    !!sale &&
    (!booking ||
      ("paymentStatus" in sale &&
        sale.status !== "cancelled" &&
        sale.paymentStatus !== "refunded"));
  let state = old.state;
  if (old.state === "approved" && !money.eligible)
    state = unlinked ? "pending" : "reversed";
  else if (old.state === "reversed" && unlinked && money.eligible && money.net > 0)
    state = "pending";
  const approvedNet = state === "approved" ? money.net : 0;
  if (
    old.eligibleNet === money.net &&
    old.eligible === money.eligible &&
    old.state === state &&
    old.approvedNet === approvedNet
  )
    return old._id;
  const reopened = state === "pending" && old.state !== "pending";
  await ctx.db.patch(old._id, {
    state,
    // A reopened credit carries no decision; its history keeps the earlier one.
    ...(reopened ? { reason: undefined } : {}),
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
    reopened ? "review_required" : state !== old.state ? "reversed" : "amount_changed",
    reopened
      ? "A paid order row was unlinked, moving money between this sale and another; review again before approving."
      : undefined,
  );
  return old._id;
}
