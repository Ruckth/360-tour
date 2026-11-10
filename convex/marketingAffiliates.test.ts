// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
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
      pricePerNight: 1000,
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
    amount = 100,
  ) => {
    const { couponId } = await admin.mutation(api.marketing.saveCoupon, {
      code: `${scope === "services" ? "SPA" : "STAY"}${amount}`,
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
    t.mutation(api.bookings.create, {
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
    return admin.mutation(api.adminBookings.recordPayment, {
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
    writer.mutation(api.marketing.saveCampaign, { ...fields, budget: 1 }),
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
      pricePerNight: 1000,
      currency: "THB",
    },
  ]);
  await expect(writer.query(api.properties.adminList, {})).rejects.toThrow();
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
    flags: ["affiliate_conflict", "self_referral"],
  });
  await expect(s.approve(anna)).rejects.toThrow("settled");
  await s.pay(bookingId);
  await expect(s.approve()).rejects.toThrow("explicitly");
  await s.approve(bob);
  row = await s.credit();
  expect(row).toMatchObject({
    affiliateId: bob,
    state: "approved",
    approvedNet: 1900,
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
    approvedNet: 1900,
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
    approvedNet: 1900,
    candidates: [{ origin: "coupon" }],
  });
  await s.pay(bookingId);
  expect(
    (await s.admin.query(api.marketingAffiliates.listCredits, {})).rows,
  ).toHaveLength(1);
  const beforeEdit = (await s.t.run((ctx) => ctx.db.get(bookingId)))!;
  await s.admin.mutation(api.adminBookings.editBooking, {
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
    await s.admin.mutation(api.adminBookings.recordRefund, {
      bookingId,
      expectedRevision: booking.revision ?? 0,
      amount,
      currency: "THB",
      method: "cash",
      reason: "Guest refund",
      idempotencyKey: key,
    });
  };
  await refund(400, "partial-refund-key");
  row = await s.credit();
  expect(row).toMatchObject({
    state: "approved",
    approvedNet: 1500,
    eligibleNet: 1500,
  });
  await refund(1500, "full-refund-key");
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
  const couponId = await s.coupon(anna, "services", 100);
  const staffId = await s.admin.mutation(api.adminServices.createStaff, {
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
  const serviceId = await s.admin.mutation(api.adminServices.createService, {
    slug: "spa",
    name: "Spa",
    description: "",
    category: "Spa",
    durationMin: 60,
    bufferMin: 0,
    price: 1000,
    currency: "THB",
    staffIds: [staffId],
  });
  const { bookingId } = await s.book({ slug: "r/anna" });
  const { orderId } = await s.admin.mutation(api.pos.openOrderFor, {
    bookingId,
  });
  await s.admin.mutation(api.pos.addItem, {
    orderId,
    item: { kind: "service", serviceId },
  });
  await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: "SPA100" });
  const view = (await s.admin.query(api.pos.getOrder, { orderId }))!;
  const args = {
    orderId,
    idempotencyKey: "pos-payment-key",
    expectedRevision: view.order.revision,
    expectedDue: view.totals.due,
    tenders: [{ method: "cash" as const, amount: view.totals.due }],
  };
  await s.admin.mutation(api.pos.settleOrder, args);
  await s.admin.mutation(api.pos.settleOrder, args);
  const rows = (await s.admin.query(api.marketingAffiliates.listCredits, {}))
    .rows;
  expect(rows).toHaveLength(2);
  expect(rows.find((c) => c.billId === orderId)).toMatchObject({
    eligibleNet: 900,
    flags: ["staff_order"],
    candidates: [{ couponId }],
  });
  expect(rows.find((c) => c.bookingId === bookingId)).toMatchObject({
    eligibleNet: 2000,
  });
  const orderCredit = rows.find((c) => c.billId === orderId)!;
  await s.admin.mutation(api.marketingAffiliates.reviewCredit, {
    creditId: orderCredit._id,
    decision: "approved",
    reason: "Verified staff referral",
    expectedRevision: orderCredit.revision,
  });
  await s.admin.mutation(api.pos.voidUnreceivedOrder, {
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
    budget: 500,
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
  expect((await s.t.run((ctx) => ctx.db.get(s.campaignId)))?.budget).toBe(500);
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
    benefit: { kind: "fixed" as const, amount: 100 },
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
  const { bookingId } = await s.t.mutation(api.bookings.create, {
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
    candidates: [{ linkId: alias }],
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
  await t.t.run((ctx) => ctx.db.patch(bookingId, { amountPaid: 1500 }));
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
    ctx.db.insert("bookings", {
      propertyId: s.propertyId,
      guestName: "Legacy",
      guestPhone: "+66811112222",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      guests: 2,
      nights: 2,
      subtotal: 2000,
      discountAmount: 0,
      total: 2000,
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
  await s.coupon(anna, "services", 1000);
  const staffId = await s.admin.mutation(api.adminServices.createStaff, {
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
  const serviceId = await s.admin.mutation(api.adminServices.createService, {
    slug: "spa",
    name: "Spa",
    description: "",
    category: "Spa",
    durationMin: 60,
    bufferMin: 0,
    price: 1000,
    currency: "THB",
    staffIds: [staffId],
  });
  const { orderId } = await s.admin.mutation(api.pos.addItem, {
    item: { kind: "service", serviceId },
  });
  await s.admin.mutation(api.pos.applyOrderCoupon, {
    orderId,
    code: "SPA1000",
  });
  const view = (await s.admin.query(api.pos.getOrder, { orderId }))!;
  await s.admin.mutation(api.pos.settleOrder, {
    orderId,
    idempotencyKey: "zero-cash-order",
    expectedRevision: view.order.revision,
    expectedDue: 0,
    tenders: [],
  });
  expect(await s.credit()).toMatchObject({
    billId: orderId,
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
    ctx.db.patch(bookingId, { amountPaid: 500, paymentStatus: "pending" }),
  );
  await s.admin.mutation(api.marketingAffiliates.refreshCredit, {
    creditId: original._id,
  });
  expect(await s.credit()).toMatchObject({
    state: "pending",
    eligible: false,
    eligibleNet: 500,
    approvedNet: 0,
  });
  await expect(s.approve()).rejects.toThrow("settled");
  await s.pay(bookingId);
  expect(await s.credit()).toMatchObject({
    state: "pending",
    eligible: true,
    eligibleNet: 2000,
  });
  await s.approve();
  expect(await s.credit()).toMatchObject({
    state: "approved",
    approvedNet: 2000,
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
