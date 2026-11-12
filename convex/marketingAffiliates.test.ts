import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { RAW_MARKETING_RETENTION_MS } from "./lib/marketingPolicy";
import type { Id } from "./_generated/dataModel";
import { creditMoney, syncAffiliateCredit } from "./lib/affiliateCredits";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.stubEnv("SITE_URL", "https://example.com");
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-07T10:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({
    email: "admin@example.com",
    tokenIdentifier: "admin",
  });
  const propertyId = await t.run((ctx) =>
    ctx.db.insert("properties", {
      slug: "villa",
      name: "Villa",
      tagline: "",
      description: "",
      pricePerNight: 100000,
      currency: "THB",
      maxGuests: 4,
      bedrooms: 1,
      bathrooms: 1,
      area: 40,
      images: [],
      amenities: [],
      tourRoomIds: [],
      directDiscountPercent: 0,
      status: "active",
    }),
  );
  const campaignId = await admin.mutation(api.marketing.saveCampaign, {
    name: "Partners",
    source: "partner",
    medium: "affiliate",
  });
  const partner = async (slug = "anna") => {
    const id = await admin.mutation(api.marketingAffiliates.saveAffiliate, {
      name: slug,
      slug,
      campaignId,
      contactEmail: `${slug}@example.com`,
    });
    await admin.mutation(api.marketingAffiliates.setAffiliateStatus, {
      affiliateId: id,
      status: "active",
    });
    return id;
  };
  const coupon = async (
    affiliateId: Id<"marketingAffiliates">,
    scope: "accommodation" | "services" = "accommodation",
    amount = 10000,
  ) => {
    const { couponId } = await admin.mutation(api.marketing.saveCoupon, {
      code: `${scope === "services" ? "SPA" : "STAY"}${amount / 100}`,
      benefit: { kind: "fixed", amount },
      scope,
    });
    await admin.mutation(api.marketing.setCouponStatus, {
      couponId,
      status: "active",
    });
    await admin.mutation(api.marketingAffiliates.assignCoupon, {
      affiliateId,
      couponId,
    });
    return couponId;
  };
  const book = (
    options: { slug?: string; couponCode?: string; email?: string } = {},
  ) =>
    t.mutation(api.bookings.bookings.create, {
      propertySlug: "villa",
      guestName: "Guest",
      guestEmail: options.email ?? "guest@example.com",
      guestPhone: "+66811112222",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      guests: 2,
      couponCode: options.couponCode,
      ...(options.slug ? { marketing: { slug: options.slug } } : {}),
    });
  const credit = async () => {
    const { rows } = await admin.query(api.marketingAffiliates.listCredits, {});
    return rows[0]!;
  };
  const pay = async (bookingId: Id<"bookings">) => {
    const booking = (await t.run((ctx) => ctx.db.get(bookingId)))!;
    return admin.mutation(api.bookings.commands.recordPayment.recordPayment, {
      bookingId,
      expectedRevision: booking.revision ?? 0,
      expectedAmount: booking.total - (booking.amountPaid ?? 0),
      method: "cash",
      idempotencyKey: "payment-12345678",
    });
  };
  const approve = async (affiliateId?: Id<"marketingAffiliates">) => {
    const row = await credit();
    return admin.mutation(api.marketingAffiliates.reviewCredit, {
      creditId: row._id,
      expectedRevision: row.revision,
      decision: "approved",
      reason: "Reviewed referral evidence",
      affiliateId,
    });
  };
  return {
    t,
    admin,
    propertyId,
    campaignId,
    partner,
    coupon,
    book,
    credit,
    pay,
    approve,
  };
}

async function lateLinkSale() {
  const s = await setup();
  const anna = await s.partner();
  const bob = await s.partner("bob");
  await s.coupon(anna, "services");
  const staffId = await s.admin.mutation(api.services.commands.createStaff.createStaff, {
    name: "Therapist",
    role: "Therapist",
    color: "#abc",
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      start: "09:00",
      end: "18:00",
    })),
    breaks: [],
  });
  const serviceId = await s.admin.mutation(api.services.commands.createService.createService, {
    slug: "spa",
    name: "Spa",
    description: "",
    category: "Spa",
    durationMin: 60,
    bufferMin: 0,
    price: 100000,
    currency: "THB",
    staffIds: [staffId],
  });
  const { orderId, lineId } = await s.admin.mutation(api.pos.commands.addItem.addItem, {
    item: { kind: "room", propertyId: s.propertyId },
  });
  await s.admin.mutation(api.pos.commands.addItem.addItem, {
    orderId,
    item: { kind: "room", propertyId: s.propertyId },
  });
  await s.admin.mutation(api.pos.commands.addItem.addItem, {
    orderId,
    item: { kind: "service", serviceId },
  });
  await s.admin.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: "SPA100" });
  const view = (await s.admin.query(api.pos.orders.getOrder, { orderId }))!;
  expect(view.totals.due).toBe(290000);
  await s.admin.mutation(api.pos.commands.settleOrder.settleOrder, {
    orderId,
    idempotencyKey: "late-link-payment",
    expectedDue: view.totals.due,
    expectedRevision: view.order.revision,
    tenders: [{ method: "cash", amount: view.totals.due }],
  });
  const { bookingId } = await s.book({ slug: "r/bob" });
  const credit = (sourceKey: string) =>
    s.t.run(
      async (ctx) =>
        (await ctx.db
          .query("affiliateCredits")
          .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
          .unique())!,
    );
  const orderCredit = () => credit(`order:${orderId}`);
  const bookingCredit = () => credit(`booking:${bookingId}`);
  const approve = async (creditId: Id<"affiliateCredits">) => {
    const row = (await s.t.run((ctx) => ctx.db.get(creditId)))!;
    await s.admin.mutation(api.marketingAffiliates.reviewCredit, {
      creditId,
      expectedRevision: row.revision,
      decision: "approved",
      reason: "Verified referral",
    });
  };
  let attempt = 0;
  const correctionRevision = async () =>
    (await s.admin.query(api.pos.orders.getOrder, { orderId }))!.paymentRecord
      .correctionRevision;
  const link = async () => {
    const booking = (await s.t.run((ctx) => ctx.db.get(bookingId)))!;
    return s.admin.mutation(api.pos.commands.linkPaidLine.linkPaidLine, {
      orderId,
      lineId,
      bookingId,
      expectedTargetRevision: booking.revision ?? 0,
      expectedCorrectionRevision: await correctionRevision(),
      idempotencyKey: `late-link-${++attempt}`,
      reason: "Apply prepaid room nights",
      notifyGuest: false,
    });
  };
  const unlink = async (linkId: Id<"orderLineLinks">) =>
    s.admin.mutation(api.pos.commands.unlinkPaidLine.unlinkPaidLine, {
      orderId,
      linkId,
      expectedCorrectionRevision: await correctionRevision(),
      idempotencyKey: `late-unlink-${++attempt}`,
      reason: "Correct the linked stay",
    });
  return {
    ...s,
    anna,
    bob,
    orderId,
    bookingId,
    orderCredit,
    bookingCredit,
    approve,
    link,
    unlink,
    correctionRevision,
  };
}

it.each(["pending", "approved"] as const)(
  "conserves %s order referral money when room nights are linked and unlinked after payment",
  async (state) => {
    const s = await lateLinkSale();
    if (state === "approved") await s.approve((await s.orderCredit())._id);
    expect(await s.orderCredit()).toMatchObject({
      state,
      eligibleNet: 290000,
      affiliateId: s.anna,
    });

    const { linkId } = await s.link();
    const order = await s.orderCredit();
    const booking = await s.bookingCredit();
    const money = await s.t.run((ctx) =>
      creditMoney(ctx, { orderId: s.orderId }),
    );
    expect(order).toMatchObject({
      state,
      eligibleNet: money.net,
      approvedNet: state === "approved" ? money.net : 0,
    });
    expect(money.net).toBe(90000);
    expect(booking).toMatchObject({
      state: "pending",
      eligible: true,
      eligibleNet: 200000,
      affiliateId: s.bob,
    });
    expect(order.eligibleNet + booking.eligibleNet).toBe(290000);
    if (state === "approved") {
      await s.approve(booking._id);
      expect(
        (await s.orderCredit()).approvedNet +
          (await s.bookingCredit()).approvedNet,
      ).toBe(290000);
    }

    await s.unlink(linkId);
    const restored = await s.orderCredit();
    const restoredMoney = await s.t.run((ctx) =>
      creditMoney(ctx, { orderId: s.orderId }),
    );
    expect(restoredMoney.net).toBe(290000);
    expect(restored).toMatchObject({
      state,
      eligibleNet: restoredMoney.net,
      approvedNet: state === "approved" ? restoredMoney.net : 0,
    });
    expect(restored.eligibleNet + (await s.bookingCredit()).eligibleNet).toBe(
      290000,
    );
  },
);

it("requires a fresh review after unlinking an approved booking credit and allows approval after relinking", async () => {
  const s = await lateLinkSale();
  const { linkId } = await s.link();
  await s.approve((await s.bookingCredit())._id);
  const approved = await s.bookingCredit();
  await s.unlink(linkId);
  const pending = await s.bookingCredit();
  expect(pending).toMatchObject({
    state: "pending",
    eligible: false,
    eligibleNet: 0,
    approvedNet: 0,
    revision: approved.revision + 1,
  });
  const detail = (await s.admin.query(api.marketingAffiliates.getCredit, {
    creditId: pending._id,
  }))!;
  expect(detail.history[0]).toMatchObject({
    kind: "review_required",
    state: "pending",
    approvedNet: 0,
    revision: pending.revision,
    actor: "admin@example.com",
    reason: expect.stringMatching(/unlinked.*review/i),
  });
  await expect(s.approve(pending._id)).rejects.toThrow("settled");
  await s.admin.mutation(api.marketingAffiliates.refreshCredit, {
    creditId: pending._id,
  });
  expect(await s.bookingCredit()).toEqual(pending);

  await s.link();
  expect(await s.bookingCredit()).toMatchObject({
    state: "pending",
    eligible: true,
    eligibleNet: 200000,
    approvedNet: 0,
  });
  await expect(
    s.admin.mutation(api.marketingAffiliates.reviewCredit, {
      creditId: pending._id,
      expectedRevision: pending.revision,
      decision: "approved",
      reason: "Stale review",
    }),
  ).rejects.toThrow("changed");
  await s.approve(pending._id);
  expect(await s.bookingCredit()).toMatchObject({
    state: "approved",
    approvedNet: 200000,
  });
  const history = (await s.admin.query(api.marketingAffiliates.getCredit, {
    creditId: pending._id,
  }))!.history;
  expect(history.map((row) => row.kind)).toEqual([
    "reviewed",
    "amount_changed",
    "review_required",
    "reviewed",
    "amount_changed",
    "created",
  ]);
});

it("still reverses an approved late-linked booking credit when its order is voided as unreceived", async () => {
  const s = await lateLinkSale();
  await s.approve((await s.orderCredit())._id);
  await s.link();
  await s.approve((await s.bookingCredit())._id);
  await s.admin.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, {
    orderId: s.orderId,
    expectedCorrectionRevision: await s.correctionRevision(),
    idempotencyKey: "late-linked-void",
    reason: "Card payment never received",
  });
  expect(await s.orderCredit()).toMatchObject({
    state: "reversed",
    eligibleNet: 0,
    approvedNet: 0,
  });
  const booking = await s.bookingCredit();
  expect(booking).toMatchObject({
    state: "reversed",
    eligible: false,
    eligibleNet: 0,
    approvedNet: 0,
  });
  const detail = (await s.admin.query(api.marketingAffiliates.getCredit, {
    creditId: booking._id,
  }))!;
  expect(detail.history[0]).toMatchObject({
    kind: "reversed",
    state: "reversed",
    approvedNet: 0,
  });
});

it("does not reopen a genuinely cancelled booking credit when its paid room row is unlinked", async () => {
  const s = await lateLinkSale();
  const { linkId } = await s.link();
  await s.approve((await s.bookingCredit())._id);
  const booking = (await s.t.run((ctx) => ctx.db.get(s.bookingId)))!;
  await s.admin.mutation(api.bookings.commands.cancelStay.cancelStay, {
    bookingId: s.bookingId,
    expectedRevision: booking.revision ?? 0,
    reason: "Guest cancelled the stay",
    notifyGuest: false,
  });
  expect(await s.bookingCredit()).toMatchObject({
    state: "reversed",
    approvedNet: 0,
  });
  await s.unlink(linkId);
  expect(await s.bookingCredit()).toMatchObject({
    state: "reversed",
    eligibleNet: 0,
    approvedNet: 0,
  });
});

it("reopens an approved order credit for review when an unlink returns money after the rest was refunded", async () => {
  const s = await lateLinkSale();
  await s.approve((await s.orderCredit())._id);
  const { linkId } = await s.link();
  // Refund the order's remaining service money while the room nights sit on the booking.
  await s.t.run(async (ctx) => {
    const now = Date.now();
    const service = (await ctx.db.query("services").first())!;
    const appointmentId = await insertFixture(ctx, "appointments", {
      serviceId: service._id, staffId: service.staffIds[0], start: now, end: now + 3_600_000,
      blockedUntil: now + 3_600_000, guestName: "Walk-in", guestPhone: "", source: "admin",
      status: "completed", paymentStatus: "paid", price: 100000, currency: "THB", confirmationCode: "APPT-1", accessToken: "appt-token", createdAt: now,
    } as never);
    await ctx.db.insert("appointmentRefunds", {
      appointmentId, amount: 90000, currency: "THB", method: "cash",
      reason: "Service refunded", effectiveAt: now, recordedAt: now, recordedBy: "admin@example.com",
      idempotencyKey: "service-refund", orderId: s.orderId, netBefore: 90000, netAfter: 0,
    });
    await syncAffiliateCredit(ctx, { orderId: s.orderId }, "admin@example.com");
  });
  expect(await s.orderCredit()).toMatchObject({ state: "reversed", approvedNet: 0 });

  await s.unlink(linkId);
  const reopened = await s.orderCredit();
  expect(reopened).toMatchObject({ state: "pending", eligible: true, eligibleNet: 200000, approvedNet: 0 });
  expect(reopened.reason).toBeUndefined();
  await s.approve(reopened._id);
  expect(await s.orderCredit()).toMatchObject({ state: "approved", approvedNet: 200000 });
});

it("claims email invitations explicitly, binds canonical identity and prevents escalation or forged identity args", async () => {
  const s = await setup();
  const user = s.t.withIdentity({
    email: "manager@example.com",
    tokenIdentifier: "issuer|manager",
  });
  await s.admin.mutation(api.marketingAccess.setGrant, {
    email: " MANAGER@example.com ",
    role: "manager",
  });
  expect(await user.query(api.marketingAccess.current, {})).toMatchObject({
    role: null,
    pendingInvitation: { role: "manager" },
  });
  await expect(
    user.mutation(api.marketing.saveCampaign, {
      name: "No",
      source: "x",
      medium: "x",
    }),
  ).rejects.toThrow("Not authorized");
  await user.mutation(api.marketingAccess.claimInvite, {});
  expect(await user.query(api.marketingAccess.current, {})).toMatchObject({
    role: "manager",
    capabilities: { publish: true, manageAccess: false },
  });
  await expect(
    user.mutation(api.marketingAccess.setGrant, {
      email: "manager@example.com",
      role: "finance",
    }),
  ).rejects.toThrow();
  await expect(
    s.t
      .withIdentity({
        email: "manager@example.com",
        tokenIdentifier: "other-issuer|manager",
      })
      .mutation(api.marketingAccess.claimInvite, {}),
  ).rejects.toThrow("No unclaimed");
  expect(
    (
      await s.t
        .withIdentity({
          email: "new@example.com",
          tokenIdentifier: "issuer|manager",
        })
        .query(api.marketingAccess.current, {})
    ).role,
  ).toBe("manager");
  await expect(
    user.mutation(api.marketingAccess.claimInvite, {
      userId: "admin",
    } as never),
  ).rejects.toThrow();
  await s.admin.mutation(api.marketingAccess.setGrant, {
    email: "manager@example.com",
    role: null,
  });
  expect((await user.query(api.marketingAccess.current, {})).role).toBeNull();
});
it("restricts marketer to draft edits, protects budgets/status/active data and operational admin gates", async () => {
  const s = await setup();
  await s.admin.mutation(api.marketingAccess.setGrant, {
    email: "writer@example.com",
    role: "marketer",
  });
  const writer = s.t.withIdentity({
    email: "writer@example.com",
    tokenIdentifier: "writer",
  });
  await writer.mutation(api.marketingAccess.claimInvite, {});
  const fields = { name: "Draft", source: "social", medium: "social" };
  const campaignId = await writer.mutation(api.marketing.saveCampaign, fields);
  await writer.mutation(api.marketing.saveCampaign, {
    ...fields,
    campaignId,
    name: "Edited",
  });
  await expect(
    writer.mutation(api.marketing.saveCampaign, { ...fields, budget: 100 }),
  ).rejects.toThrow("budgets");
  await expect(
    writer.mutation(api.marketing.setCampaignStatus, {
      campaignId,
      status: "active",
    }),
  ).rejects.toThrow();
  await s.admin.mutation(api.marketing.setCampaignStatus, {
    campaignId,
    status: "active",
  });
  await expect(
    writer.mutation(api.marketing.saveCampaign, { ...fields, campaignId }),
  ).rejects.toThrow("drafts only");
  expect(await writer.query(api.marketing.catalog, {})).toMatchObject([
    {
      _id: s.propertyId,
      name: "Villa",
      slug: "villa",
      status: "active",
      pricePerNight: 100000,
      currency: "THB",
    },
  ]);
  await expect(writer.query(api.catalog.properties.adminList, {})).rejects.toThrow();
  await expect(
    writer.mutation(api.marketingAffiliates.saveAffiliate, {
      name: "No",
      slug: "no",
      campaignId,
    }),
  ).rejects.toThrow();
});
it("creates a draft canonical alias, preserves slug and safely synchronizes partner status", async () => {
  const s = await setup();
  const affiliateId = await s.admin.mutation(
    api.marketingAffiliates.saveAffiliate,
    { name: "Anna", slug: "ANNA", campaignId: s.campaignId },
  );
  expect(
    await s.t.query(api.marketing.resolveLink, { slug: "r/anna" }),
  ).toBeNull();
  await s.admin.mutation(api.marketingAffiliates.setAffiliateStatus, {
    affiliateId,
    status: "active",
  });
  expect(
    await s.t.query(api.marketing.resolveLink, { slug: "r/anna" }),
  ).toMatchObject({ status: "active", path: "/booking?mk=r%2Fanna" });
  await expect(
    s.admin.mutation(api.marketingAffiliates.saveAffiliate, {
      id: affiliateId,
      name: "New",
      slug: "new",
      campaignId: s.campaignId,
    }),
  ).rejects.toThrow("permanent");
  await s.admin.mutation(api.marketingAffiliates.setAffiliateStatus, {
    affiliateId,
    status: "paused",
  });
  expect(
    await s.t.query(api.marketing.resolveLink, { slug: "r/anna" }),
  ).toMatchObject({ status: "paused", offerRemoved: true });
});
it("freezes link/coupon conflict and self-referral candidates, requires explicit review and preserves decisions", async () => {
  const s = await setup();
  const anna = await s.partner();
  const bob = await s.partner("bob");
  await s.coupon(bob);
  const { bookingId } = await s.book({
    slug: "r/anna",
    couponCode: "STAY100",
    email: "anna@example.com",
  });
  let row = await s.credit();
  expect(row).toMatchObject({
    affiliateId: anna,
    state: "pending",
    eligible: false,
    flags: ["affiliate_conflict", "self_referral", "referral_claimed_slug"],
  });
  await expect(s.approve(anna)).rejects.toThrow("settled");
  await s.pay(bookingId);
  await expect(s.approve()).rejects.toThrow("explicitly");
  await s.approve(bob);
  row = await s.credit();
  expect(row).toMatchObject({
    affiliateId: bob,
    state: "approved",
    approvedNet: 190000,
  });
  await s.admin.mutation(api.marketingAffiliates.assignCoupon, {
    affiliateId: bob,
    couponId: null,
  });
  await s.admin.mutation(api.marketingAffiliates.refreshCredit, {
    creditId: row._id,
  });
  expect(await s.credit()).toMatchObject({
    affiliateId: bob,
    snapshot: {
      affiliateId: anna,
      candidates: [{ affiliateId: anna }, { affiliateId: bob }],
    },
    approvedNet: 190000,
  });
  const detail = await s.admin.query(api.marketingAffiliates.getCredit, {
    creditId: row._id,
  });
  expect(detail?.history.map((h) => h.kind)).toEqual([
    "reviewed",
    "amount_changed",
    "created",
  ]);
});
it("supports coupon-only claims, retries once and updates approved net on partial/full refunds", async () => {
  const s = await setup();
  const anna = await s.partner();
  await s.coupon(anna);
  const { bookingId } = await s.book({ couponCode: "STAY100" });
  await s.pay(bookingId);
  await s.approve();
  let row = await s.credit();
  expect(row).toMatchObject({
    affiliateId: anna,
    approvedNet: 190000,
    candidates: [{ origin: "coupon" }],
  });
  await s.pay(bookingId);
  expect(
    (await s.admin.query(api.marketingAffiliates.listCredits, {})).rows,
  ).toHaveLength(1);
  const beforeEdit = (await s.t.run((ctx) => ctx.db.get(bookingId)))!;
  await s.admin.mutation(api.bookings.commands.editBooking.editBooking, {
    bookingId,
    propertyId: s.propertyId,
    checkIn: beforeEdit.checkIn,
    checkOut: beforeEdit.checkOut,
    guests: 2,
    guestName: beforeEdit.guestName,
    guestPhone: beforeEdit.guestPhone,
    guestEmail: beforeEdit.guestEmail,
    expectedRevision: beforeEdit.revision ?? 0,
    priceOverride: { total: 0, reason: "Goodwill refund" },
    expectedPrice: { total: 0, currency: "THB" },
    notifyGuest: false,
  });
  const refund = async (amount: number, key: string) => {
    const booking = (await s.t.run((ctx) => ctx.db.get(bookingId)))!;
    await s.admin.mutation(api.bookings.commands.recordRefund.recordRefund, {
      bookingId,
      expectedRevision: booking.revision ?? 0,
      amount,
      currency: "THB",
      method: "cash",
      reason: "Guest refund",
      idempotencyKey: key,
    });
  };
  await refund(40000, "partial-refund-key");
  row = await s.credit();
  expect(row).toMatchObject({
    state: "approved",
    approvedNet: 150000,
    eligibleNet: 150000,
  });
  await refund(150000, "full-refund-key");
  row = await s.credit();
  expect(row).toMatchObject({
    state: "reversed",
    approvedNet: 0,
    eligibleNet: 0,
  });
  const history = (await s.admin.query(api.marketingAffiliates.getCredit, {
    creditId: row._id,
  }))!.history;
  expect(history[0]).toMatchObject({ kind: "reversed", approvedNet: 0 });
  await s.admin.mutation(api.marketingAffiliates.refreshCredit, {
    creditId: row._id,
  });
  expect(
    (await s.admin.query(api.marketingAffiliates.getCredit, {
      creditId: row._id,
    }))!.history,
  ).toHaveLength(history.length);
});
it("does not backfill legacy sales or reopen rejected credits, and refuses archived candidate approval", async () => {
  const s = await setup();
  const anna = await s.partner();
  const { bookingId } = await s.book({ slug: "r/anna" });
  const row = await s.credit();
  await s.admin.mutation(api.marketingAffiliates.reviewCredit, {
    creditId: row._id,
    decision: "rejected",
    reason: "Not a genuine referral",
    expectedRevision: row.revision,
  });
  await s.pay(bookingId);
  expect(await s.credit()).toMatchObject({ state: "rejected", approvedNet: 0 });
  await expect(s.approve()).rejects.toThrow("pending");
  await s.t.run(async (ctx) => {
    await ctx.db.patch(bookingId, { affiliateSnapshot: undefined });
  });
  await s.admin.mutation(api.marketingAffiliates.setAffiliateStatus, {
    affiliateId: anna,
    status: "archived",
  });
  expect(
    (await s.admin.query(api.marketingAffiliates.listAffiliates, {})).rows[0]
      .summary,
  ).toMatchObject({ rejected: 1, approvedNet: 0 });
});
it("enforces read/finance roles on public APIs and validates stale revisions and reasons", async () => {
  const s = await setup();
  await s.partner();
  const { bookingId } = await s.book({ slug: "r/anna" });
  await s.pay(bookingId);
  const row = await s.credit();
  for (const role of ["viewer", "finance"] as const) {
    const email = `${role}@example.com`;
    await s.admin.mutation(api.marketingAccess.setGrant, { email, role });
    const user = s.t.withIdentity({ email, tokenIdentifier: role });
    await user.mutation(api.marketingAccess.claimInvite, {});
    expect(
      (await user.query(api.marketingAffiliates.listCredits, {})).rows,
    ).toHaveLength(1);
    await expect(
      user.mutation(api.marketing.saveCampaign, {
        name: "x",
        source: "x",
        medium: "x",
      }),
    ).rejects.toThrow();
    const review = {
      creditId: row._id,
      decision: "approved" as const,
      reason: "Verified",
      expectedRevision: row.revision,
    };
    if (role === "viewer")
      await expect(
        user.mutation(api.marketingAffiliates.reviewCredit, review),
      ).rejects.toThrow();
    else {
      await expect(
        user.mutation(api.marketingAffiliates.reviewCredit, {
          ...review,
          expectedRevision: -1,
        }),
      ).rejects.toThrow("changed");
      await expect(
        user.mutation(api.marketingAffiliates.reviewCredit, {
          ...review,
          reason: "",
        }),
      ).rejects.toThrow("reason");
      await user.mutation(api.marketingAffiliates.reviewCredit, review);
    }
  }
  await expect(
    s.t.query(api.marketingAffiliates.listCredits, {}),
  ).rejects.toThrow();
});
it("freezes POS settlement and excludes stay money from order credit, then reverses a no-money void", async () => {
  const s = await setup();
  const anna = await s.partner();
  const couponId = await s.coupon(anna, "services", 10000);
  const staffId = await s.admin.mutation(api.services.commands.createStaff.createStaff, {
    name: "Therapist",
    role: "Therapist",
    color: "#abc",
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      start: "09:00",
      end: "18:00",
    })),
    breaks: [],
  });
  const serviceId = await s.admin.mutation(api.services.commands.createService.createService, {
    slug: "spa",
    name: "Spa",
    description: "",
    category: "Spa",
    durationMin: 60,
    bufferMin: 0,
    price: 100000,
    currency: "THB",
    staffIds: [staffId],
  });
  const { bookingId } = await s.book({ slug: "r/anna" });
  const { orderId } = await s.admin.mutation(api.pos.commands.openOrderFor.openOrderFor, {
    bookingId,
  });
  await s.admin.mutation(api.pos.commands.addItem.addItem, {
    orderId,
    item: { kind: "service", serviceId },
  });
  await s.admin.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: "SPA100" });
  const view = (await s.admin.query(api.pos.orders.getOrder, { orderId }))!;
  const args = {
    orderId,
    idempotencyKey: "pos-payment-key",
    expectedRevision: view.order.revision,
    expectedDue: view.totals.due,
    tenders: [{ method: "cash" as const, amount: view.totals.due }],
  };
  await s.admin.mutation(api.pos.commands.settleOrder.settleOrder, args);
  await s.admin.mutation(api.pos.commands.settleOrder.settleOrder, args);
  const rows = (await s.admin.query(api.marketingAffiliates.listCredits, {}))
    .rows;
  expect(rows).toHaveLength(2);
  expect(rows.find((c) => c.orderId === orderId)).toMatchObject({
    eligibleNet: 90000,
    flags: ["staff_order"],
    candidates: [{ couponId }],
  });
  expect(rows.find((c) => c.bookingId === bookingId)).toMatchObject({
    eligibleNet: 200000,
  });
  const orderCredit = rows.find((c) => c.orderId === orderId)!;
  await s.admin.mutation(api.marketingAffiliates.reviewCredit, {
    creditId: orderCredit._id,
    decision: "approved",
    reason: "Verified staff referral",
    expectedRevision: orderCredit.revision,
  });
  await s.admin.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, {
    orderId,
    expectedCorrectionRevision: 0,
    idempotencyKey: "pos-void-key",
    reason: "No money received",
  });
  expect(
    (
      await s.admin.query(api.marketingAffiliates.getCredit, {
        creditId: orderCredit._id,
      })
    )?.credit,
  ).toMatchObject({ state: "reversed", eligibleNet: 0, approvedNet: 0 });
});
it("keeps marketer edits to budgeted drafts safe and blocks active link/coupon edits", async () => {
  const s = await setup();
  await s.admin.mutation(api.marketing.saveCampaign, {
    campaignId: s.campaignId,
    name: "Budgeted",
    source: "partner",
    medium: "affiliate",
    budget: 50000,
  });
  await s.admin.mutation(api.marketingAccess.setGrant, {
    email: "writer@example.com",
    role: "marketer",
  });
  const writer = s.t.withIdentity({
    email: "writer@example.com",
    tokenIdentifier: "writer",
  });
  await writer.mutation(api.marketingAccess.claimInvite, {});
  await writer.mutation(api.marketing.saveCampaign, {
    campaignId: s.campaignId,
    name: "Edited",
    source: "partner",
    medium: "affiliate",
  });
  expect((await s.t.run((ctx) => ctx.db.get(s.campaignId)))?.budget).toBe(50000);
  const args = {
    slug: "writer",
    name: "Draft",
    campaignId: s.campaignId,
    destination: { kind: "home" as const },
    entry: "link" as const,
  };
  const linkId = await writer.mutation(api.marketing.saveLink, args);
  await writer.mutation(api.marketing.saveLink, {
    ...args,
    linkId,
    name: "Changed",
  });
  await s.admin.mutation(api.marketing.setLinkStatus, {
    linkId,
    status: "active",
  });
  await expect(
    writer.mutation(api.marketing.saveLink, { ...args, linkId }),
  ).rejects.toThrow("drafts only");
  const rules = {
    code: "WRITER",
    benefit: { kind: "fixed" as const, amount: 10000 },
    scope: "services" as const,
  };
  const { couponId } = await writer.mutation(api.marketing.saveCoupon, rules);
  await writer.mutation(api.marketing.saveCoupon, { ...rules, couponId });
  await s.admin.mutation(api.marketing.setCouponStatus, {
    couponId,
    status: "active",
  });
  await expect(
    writer.mutation(api.marketing.saveCoupon, { ...rules, couponId }),
  ).rejects.toThrow("drafts only");
});
it("uses the last eligible affiliate touch independently of the last acquisition link", async () => {
  const s = await setup();
  const anna = await s.partner();
  const alias = (
    await s.admin.query(api.marketingAffiliates.listAffiliates, {})
  ).rows[0].canonicalLinkId!;
  const ordinary = await s.admin.mutation(api.marketing.saveLink, {
    slug: "ordinary",
    name: "Ordinary",
    campaignId: s.campaignId,
    destination: { kind: "home" },
    entry: "link",
  });
  await s.admin.mutation(api.marketing.setLinkStatus, {
    linkId: ordinary,
    status: "active",
  });
  const visitorKey = "mv_" + "a".repeat(32);
  await s.t.run(async (ctx) => {
    await ctx.db.insert("marketingSessions", {
      visitorKey,
      linkId: alias,
      campaignId: s.campaignId,
      landingPath: "/booking",
      startedAt: Date.now() - 2000,
    });
    await ctx.db.insert("marketingSessions", {
      visitorKey,
      linkId: ordinary,
      campaignId: s.campaignId,
      landingPath: "/booking",
      startedAt: Date.now() - 1000,
    });
  });
  const { bookingId } = await s.t.mutation(api.bookings.bookings.create, {
    propertySlug: "villa",
    guestName: "Guest",
    guestEmail: "guest@example.com",
    guestPhone: "+66811112222",
    checkIn: "2026-11-10",
    checkOut: "2026-11-12",
    guests: 2,
    marketing: { visitorKey },
  });
  const booking = await s.t.run((ctx) => ctx.db.get(bookingId));
  expect(booking?.marketingAttribution?.last?.linkId).toBe(ordinary);
  expect(booking?.affiliateSnapshot).toMatchObject({
    affiliateId: anna,
    candidates: [{ linkId: alias, evidence: "recorded_session" }],
    flags: [],
  });
});
it("rejects out-of-scope and expired candidates, archived approvals and unseen money changes", async () => {
  const s = await setup();
  const anna = await s.partner();
  await s.admin.mutation(api.marketingAffiliates.saveAffiliate, {
    id: anna,
    name: "Anna",
    slug: "anna",
    campaignId: s.campaignId,
    endsOn: "2026-11-06",
  });
  await s.book({ slug: "r/anna" });
  let row = await s.credit();
  expect(row.candidates[0]).toMatchObject({
    eligible: false,
    reason: "outside_dates",
  });
  await s.pay(row.bookingId!);
  await expect(s.approve()).rejects.toThrow("eligible frozen");
  await s.admin.mutation(api.marketingAffiliates.reviewCredit, {
    creditId: row._id,
    decision: "rejected",
    reason: "Expired partner",
    expectedRevision: (await s.credit()).revision,
  });
  const t = await setup();
  const partner = await t.partner();
  const { bookingId } = await t.book({ slug: "r/anna" });
  await t.pay(bookingId);
  row = await t.credit();
  await t.t.run((ctx) => ctx.db.patch(bookingId, { amountPaid: 150000 }));
  await expect(t.approve()).rejects.toThrow("Sale changed");
  await t.admin.mutation(api.marketingAffiliates.refreshCredit, {
    creditId: row._id,
  });
  await t.admin.mutation(api.marketingAffiliates.setAffiliateStatus, {
    affiliateId: partner,
    status: "archived",
  });
  await expect(t.approve()).rejects.toThrow("Archived");
});
it("does not infer any historical affiliate credit when an older sale is paid", async () => {
  const s = await setup();
  await s.partner();
  const bookingId = await s.t.run((ctx) =>
    insertFixture(ctx, "bookings", {
      propertyId: s.propertyId,
      guestName: "Legacy",
      guestPhone: "+66811112222",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      guests: 2,
      nights: 2,
      subtotal: 200000,
      discountAmount: 0,
      total: 200000,
      currency: "THB",
      paymentStatus: "pending",
      status: "confirmed",
      createdAt: 0,
    }),
  );
  await s.pay(bookingId);
  expect(
    (await s.admin.query(api.marketingAffiliates.listCredits, {})).rows,
  ).toEqual([]);
});
it("keeps zero-cash coupon-covered service orders as zero-net reporting credit without payouts", async () => {
  const s = await setup();
  const anna = await s.partner();
  await s.coupon(anna, "services", 100000);
  const staffId = await s.admin.mutation(api.services.commands.createStaff.createStaff, {
    name: "Therapist",
    role: "Therapist",
    color: "#abc",
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      start: "09:00",
      end: "18:00",
    })),
    breaks: [],
  });
  const serviceId = await s.admin.mutation(api.services.commands.createService.createService, {
    slug: "spa",
    name: "Spa",
    description: "",
    category: "Spa",
    durationMin: 60,
    bufferMin: 0,
    price: 100000,
    currency: "THB",
    staffIds: [staffId],
  });
  const { orderId } = await s.admin.mutation(api.pos.commands.addItem.addItem, {
    item: { kind: "service", serviceId },
  });
  await s.admin.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, {
    orderId,
    code: "SPA1000",
  });
  const view = (await s.admin.query(api.pos.orders.getOrder, { orderId }))!;
  await s.admin.mutation(api.pos.commands.settleOrder.settleOrder, {
    orderId,
    idempotencyKey: "zero-cash-order",
    expectedRevision: view.order.revision,
    expectedDue: 0,
    tenders: [],
  });
  expect(await s.credit()).toMatchObject({
    orderId: orderId,
    eligible: true,
    eligibleNet: 0,
  });
  await s.approve();
  expect(await s.credit()).toMatchObject({ state: "approved", approvedNet: 0 });
});

it("keeps deposits pending for review until the booking is fully paid", async () => {
  const s = await setup();
  await s.partner();
  const { bookingId } = await s.book({ slug: "r/anna" });
  const original = await s.credit();
  await s.t.run((ctx) =>
    ctx.db.patch(bookingId, { amountPaid: 50000, paymentStatus: "pending" }),
  );
  await s.admin.mutation(api.marketingAffiliates.refreshCredit, {
    creditId: original._id,
  });
  expect(await s.credit()).toMatchObject({
    state: "pending",
    eligible: false,
    eligibleNet: 50000,
    approvedNet: 0,
  });
  await expect(s.approve()).rejects.toThrow("settled");
  await s.pay(bookingId);
  expect(await s.credit()).toMatchObject({
    state: "pending",
    eligible: true,
    eligibleNet: 200000,
  });
  await s.approve();
  expect(await s.credit()).toMatchObject({
    state: "approved",
    approvedNet: 200000,
  });
});

it("does not pretend invitations can revoke or downgrade configured system administrators", async () => {
  const s = await setup();
  for (const role of [null, "viewer"] as const) {
    await expect(s.admin.mutation(api.marketingAccess.setGrant, { email: "admin@example.com", role })).rejects.toThrow("ADMIN_EMAILS");
  }
  expect((await s.admin.query(api.marketingAccess.current, {})).role).toBe("admin");
  expect(await s.admin.query(api.marketingAccess.listGrants, {})).toEqual([]);
});


it.each(["create", "confirmProposal"] as const)("freezes recorded vs claimed evidence through bookings.%s", async path => {
  for (const recorded of [false, true]) {
    const s = await setup();
    const anna = await s.partner();
    const link = (await s.t.run(ctx => ctx.db.get(anna)))!.canonicalLinkId!;
    const visitorKey = "mv_" + "b".repeat(32);
    // An anonymous open and another visitor's session do not establish this guest's visit.
    await s.t.mutation(api.marketing.recordOpen, { slug: "r/anna", bot: false });
    await s.t.mutation(api.marketing.startSession, { slug: "r/anna", landingPath: "/", visitorKey: "mv_" + "c".repeat(32) });
    if (recorded) await s.t.mutation(api.marketing.startSession, { slug: "r/anna", landingPath: "/", visitorKey });
    const stay = {
      propertySlug: "villa", guestName: "Guest", guestEmail: "guest@example.com",
      guestPhone: "+66811112222", checkIn: "2026-11-10", checkOut: "2026-11-12", guests: 2,
    };
    const marketing = { slug: "r/anna", visitorKey };
    const result = path === "create"
      ? await s.t.mutation(api.bookings.bookings.create, { ...stay, marketing })
      : await (async () => {
        const { sessionId } = await s.t.mutation(api.messaging.chat.createSession, { channel: "web" });
        const { confirmToken } = await s.t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, propertySlug: stay.propertySlug, guestName: stay.guestName, guestPhone: stay.guestPhone, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests });
        const result = await s.t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken, marketing });
        if (result.needsReview) throw new Error("Expected a confirmed booking");
        return result;
      })();
    const before = await s.t.run(ctx => ctx.db.get(result.bookingId));
    const evidence = recorded ? "recorded_session" : "claimed_slug";
    const flags = recorded ? [] : ["referral_claimed_slug"];
    expect(before?.affiliateSnapshot).toMatchObject({
      affiliateId: anna, candidates: [{ linkId: link, evidence }], flags,
    });
    const credit = await s.credit();
    expect(credit.snapshot).toEqual(before?.affiliateSnapshot);
    expect(credit.flags).toEqual(flags);
    // Raw retention must not rewrite sale attribution, frozen evidence, counters or credits.
    await s.t.run(async ctx => {
      for (const session of await ctx.db.query("marketingSessions").collect())
        await ctx.db.patch(session._id, { startedAt: Date.now() - RAW_MARKETING_RETENTION_MS - 1 });
      for (const event of await ctx.db.query("marketingEvents").collect())
        await ctx.db.patch(event._id, { occurredAt: Date.now() - RAW_MARKETING_RETENTION_MS - 1 });
    });
    const linkBefore = await s.t.run(ctx => ctx.db.get(link));
    const aggregatesBefore = await s.t.run(ctx => ctx.db.query("marketingSessionDays").collect());
    await s.t.mutation(internal.crons.cleanRawMarketing, {});
    expect(await s.t.run(ctx => ctx.db.get(result.bookingId))).toEqual(before);
    expect(await s.credit()).toEqual(credit);
    expect(await s.t.run(ctx => ctx.db.get(link))).toEqual(linkBefore);
    expect(await s.t.run(ctx => ctx.db.query("marketingSessionDays").collect())).toEqual(aggregatesBefore);
  }
});
