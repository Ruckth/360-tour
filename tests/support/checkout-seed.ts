import type { MutationCtx } from "convex/_generated/server";
import type { Doc, Id, TableNames } from "convex/_generated/dataModel";
import { CATALOG, createState } from "./checkout-data";
import { seedProperties } from "../../convex/maintenance/seeds/properties";
import { DEFAULT_CASHIER_RULES } from "convex/shared/staffTypes";

/** Test data only: every write after this seed crosses a real registered Convex function. */
export async function checkoutSeed(
  ctx: MutationCtx,
  aliases: Map<string, string>,
) {
  const data = createState(),
    now = Date.now();
  const bind = <T extends TableNames>(old: string, id: Id<T>) => {
    aliases.set(old, id);
    return id;
  };
  const id = <T extends TableNames>(old: string) => aliases.get(old) as Id<T>;
  const clean = <T extends object>(value: T) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([key, v]) =>
          key !== "_id" && key !== "_creationTime" && v !== undefined,
      ),
    );
  const properties = Object.values(await seedProperties(ctx));
  for (let i = 0; i < CATALOG.rooms.length; i++) {
    const row = CATALOG.rooms[i];
    bind(row._id, properties[i]);
    await ctx.db.patch(properties[i], {
      name: row.name,
      tagline: row.tagline,
      pricePerNight: row.price,
      maxGuests: row.maxGuests,
      images: row.imageUrl ? [row.imageUrl] : [],
    });
  }
  for (const staff of CATALOG.staff)
    bind(
      staff._id,
      await ctx.db.insert("staff", {
        name: staff.name,
        color: staff.color,
        role: "Therapist",
        status: "active",
        workingHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          start: "00:00",
          end: "23:59",
        })),
        breaks: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
  for (const row of CATALOG.services)
    bind(
      row._id,
      await ctx.db.insert("services", {
        ...clean(row),
        name: row.name,
        category: row.category,
        description: row.description ?? "",
        slug: row._id,
        price: row.price,
        durationMin: row.durationMin,
        bufferMin: 0,
        currency: "THB",
        staffIds: row.staffIds.map((value) => id<"staff">(value)),
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    );
  for (const row of data.customers)
    bind(
      row._id,
      await ctx.db.insert(
        "customers",
        clean(row) as Omit<Doc<"customers">, "_id" | "_creationTime">,
      ),
    );
  for (const row of data.bookings) {
    const propertyId = id<"properties">(row.propertyId!);
    bind(
      row.id,
      await ctx.db.insert("bookings", {
        propertyId,
        guestName: row.guest.name,
        guestPhone: row.guest.phone ?? "",
        guestEmail: row.guest.email,
        guestPhoneDigits: (row.guest.phone ?? "").replace(/\D/g, ""),
        guestEmailNormalized: row.guest.email?.toLowerCase(),
        checkIn: "2026-11-12",
        checkOut: "2026-11-15",
        nights: 3,
        guests: 2,
        subtotal: row.price,
        total: row.price,
        discountAmount: 0,
        amountPaid: row.deposit,
        amountRefunded: 0,
        currency: "THB",
        status: "confirmed",
        paymentStatus: "pending",
        confirmationCode: row.reference,
        guestEmailsOff: true,
        stripeCheckoutSessionId: row.checkoutInProgress
          ? "cs_test_local_fixture"
          : undefined,
        stripeCheckoutExpiresAt: row.checkoutInProgress
          ? now + 86400000
          : undefined,
        createdAt: now,
      }),
    );
    if (row.deposit)
      await ctx.db.insert("bookingPayments", {
        bookingId: id<"bookings">(row.id),
        origin: "online",
        method: "stripe",
        amount: row.deposit,
        currency: "THB",
        effectiveAt: now,
        recordedAt: now,
        recordedBy: "system:seed",
        idempotencyKey: row.id,
        status: "recorded",
        refunded: 0,
      });
  }
  for (const row of data.appointments) {
    const service = await ctx.db.get(id<"services">(row.serviceId)),
      staff = await ctx.db.get(id<"staff">(row.staffId));
    bind(
      row.appointmentId,
      await ctx.db.insert("appointments", {
        serviceId: service!._id,
        staffId: staff!._id,
        serviceNameSnapshot: service!.name,
        staffNameSnapshot: staff!.name,
        start: row.start,
        end: row.start + service!.durationMin * 60000,
        blockedUntil: row.start + service!.durationMin * 60000,
        guestName: row.guest.name,
        guestPhone: row.guest.phone ?? "",
        guestPhoneDigits: (row.guest.phone ?? "").replace(/\D/g, ""),
        guestEmail: row.guest.email,
        guestEmailNormalized: row.guest.email?.toLowerCase(),
        bookingId: row.bookingId ? id<"bookings">(row.bookingId) : undefined,
        price: row.price,
        currency: "THB",
        amountPaid: 0,
        amountRefunded: 0,
        status: "booked",
        paymentStatus: "unpaid",
        source: "admin",
        accessToken: "test-only",
        confirmationCode: row.reference,
        createdAt: now,
      }),
    );
  }
  for (const row of data.orders.values())
    bind(
      row._id,
      await ctx.db.insert("orders", {
        ...clean(row),
        bookingId: row.bookingId ? id<"bookings">(row.bookingId) : undefined,
        customerId: row.customerId
          ? id<"customers">(row.customerId)
          : undefined,
      } as Omit<Doc<"orders">, "_id" | "_creationTime">),
    );
  for (const row of data.lines)
    bind(
      row._id,
      await ctx.db.insert("orderLines", {
        ...clean(row),
        orderId: id<"orders">(row.orderId),
        serviceId: row.serviceId ? id<"services">(row.serviceId) : undefined,
        staffId: row.staffId ? id<"staff">(row.staffId) : undefined,
      } as Omit<Doc<"orderLines">, "_id" | "_creationTime">),
    );
  for (const [key, value] of data.counters)
    await ctx.db.insert("orderCounters", { key, value });
  await ctx.db.insert("cashierRules", {
    key: "default",
    ...DEFAULT_CASHIER_RULES,
    updatedAt: now,
    updatedByEmail: "system:seed",
  });
  await ctx.db.insert("siteSettings", {
    key: "default",
    businessName: "Auralis Cove Retreat",
    revision: 0,
    updatedAt: now,
    updatedByEmail: "system:seed",
  });
  for (const row of data.coupons) {
    const { code, status, version, used, discountGranted, ...rules } =
      row.rules;
    const couponId = bind(
      row.id,
      await ctx.db.insert("coupons", {
        code,
        status,
        currentVersion: version,
        used,
        discountGranted,
        createdAt: now,
        updatedAt: now,
        updatedByEmail: "system:seed",
      }),
    );
    await ctx.db.insert("couponVersions", {
      couponId,
      version,
      ...rules,
      terms: row.terms ?? undefined,
      createdAt: now,
      createdByEmail: "system:seed",
    });
  }
  const campaignId = await ctx.db.insert("marketingCampaigns", {
    name: "Fixture posters",
    source: "offline",
    medium: "qr",
    status: "active",
    createdAt: now,
    updatedAt: now,
    updatedByEmail: "system:seed",
  });
  for (const [slug, code] of Object.entries({
    q1: "DCNT-SPA-500",
    l: "DCNT-L-10",
    f1: "DCNT-F1-20",
    f: null,
    m: null,
  })) {
    const coupon = code
      ? await ctx.db
          .query("coupons")
          .withIndex("by_code", (q) => q.eq("code", code))
          .unique()
      : null;
    await ctx.db.insert("marketingLinks", {
      slug,
      name: slug,
      campaignId,
      destination: { kind: "home" },
      entry: "qr",
      status: "active",
      couponId: coupon?._id,
      opens: 0,
      createdAt: now,
      updatedAt: now,
      updatedByEmail: "system:seed",
    });
  }
  return { appointments: data.appointments };
}
