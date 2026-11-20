/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../convex/schema";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { MutationCtx } from "convex/_generated/server";
import { resolveCommerceSettings } from "../../convex/commerce/model";
import { termsOf } from "../../convex/pos/private/paymentCommerce";

/*
 * Return items on real Convex functions (convex-test, in the browser fixture server). It seeds one
 * settled commerce receipt, journey 7's Gold Wellness (5 sessions, 2 used; a Sand / M robe; ฿500
 * voucher value) paid ฿6,900 by card, and calls any public function as the signed-in staff member.
 * Nothing here simulates money: amounts come from pos.commands.returnItems itself.
 */

export type HarnessRole = "manager" | "cashier";
const EMAILS = { manager: "ploy@auraliscove.co", cashier: "mint@auraliscove.co" } as const;
const DAY = 86_400_000;
const settings = resolveCommerceSettings(null);
const terms = termsOf(settings);
type Snapshot = NonNullable<Doc<"orderLines">["saleSnapshot"]>;
const allocation = (paidShare: number) => ({ paidShare, vatBase: paidShare, returnedAmount: 0, returnedUnits: 0, tenderCells: [{ kind: "external" as const, amount: paidShare }] });

async function seedGold(ctx: MutationCtx, createdBy: string) {
  const now = Date.now();
  const orderId = await ctx.db.insert("orders", {
    orderNumber: 1042, receiptNumber: 2042, currency: "THB", status: "paid", itemCount: 1, hasItems: true,
    total: 690000, due: 0, revision: 1, paidAt: now, createdBy, createdAt: now, updatedAt: now, vatVersion: 2,
  });
  const branchId = await ctx.db.insert("branches", { key: "default" });
  const ownerId = await ctx.db.insert("customers", { name: "Maya Lin", createdAt: now, updatedAt: now, createdBy });
  const packageId = await ctx.db.insert("packages", { name: "Gold Wellness", status: "active", sort: 0, revision: 0 });
  const packageVersionId = await ctx.db.insert("packageVersions", {
    packageId, version: 1, name: "Gold Wellness", price: 690000, validityDays: 180, allowTransfer: false, contents: [], estimatedSplit: [],
  });
  const serviceId = await ctx.db.insert("services", {
    slug: "thai-60", name: "Thai massage 60", description: "", category: "Spa", durationMin: 60, bufferMin: 0,
    price: 120000, currency: "THB", staffIds: [], status: "active", createdAt: now, updatedAt: now,
  });
  const categoryId = await ctx.db.insert("productCategories", { name: "Robes", sort: 0 });
  const productId = await ctx.db.insert("products", {
    categoryId, name: "Spa robe", status: "active", vatProfile: "standard", options: [], minPrice: 129000, maxPrice: 129000, variantCount: 1, sort: 0, revision: 0,
  });
  const variantId = await ctx.db.insert("productVariants", { productId, optionValueIds: [], label: "Sand / M", price: 129000, status: "active", revision: 0 });
  await ctx.db.insert("stockLevels", { branchId, productId, variantId, onHand: 1, revision: 1 });
  const movementId = await ctx.db.insert("stockMovements", {
    branchId, variantId, delta: -1, before: 2, after: 1, kind: "sale", sourceKey: "sale:gold", actor: createdBy, createdAt: now,
  });
  const lineId = await ctx.db.insert("orderLines", {
    orderId, kind: "package", name: "Gold Wellness", currency: "THB", qty: 1, unitPrice: 690000, catalogUnitPrice: 690000, createdAt: now, packageVersionId,
  });
  const expiresAt = now + 180 * DAY;
  const grantId = await ctx.db.insert("sessionGrants", {
    ownerId, orderId, lineId, contentKey: "sessions", packageVersionId, branchId, total: 5, used: 2, paidUnits: 3, goodwillUnits: 0, returnedUnits: 0,
    paidShare: 526749, expiresAt, issuedTerms: { expiresAt, serviceIds: [serviceId], allowTransfer: false },
    settingsRevision: settings.revision, terms, grantServiceIds: [], revision: 3,
  });
  const grantServiceId = await ctx.db.insert("grantServices", { grantId, ownerId, serviceId, branchId, usable: true, expiresAt });
  await ctx.db.patch(grantId, { grantServiceIds: [grantServiceId] });
  const voucherId = await ctx.db.insert("vouchers", {
    faceValue: 50000, paidBalance: 50000, goodwillBalance: 0, issuedExpiresAt: now + 365 * DAY, effectiveExpiresAt: now + 365 * DAY,
    status: "active", branchId, source: { kind: "package", orderId, lineId, contentKey: "credit", packageVersionId }, revision: 0,
    settingsRevision: settings.revision, terms,
  });
  const contents: Snapshot["contents"] = [
    { contentKey: "sessions", label: "Thai massage 60 sessions", units: 5, grantId, vatProfile: "standard", ...allocation(526749) },
    { contentKey: "robe", label: "Spa robe · Sand / M", units: 1, stockMovementId: movementId, vatProfile: "standard", ...allocation(113251) },
    { contentKey: "credit", label: "Voucher value ฿500", units: 1, voucherId, vatProfile: "exempt", ...allocation(50000) },
  ];
  await ctx.db.patch(lineId, {
    saleSnapshot: { label: "Gold Wellness", settingsRevision: settings.revision, terms, ...allocation(690000), contents, chosenVariants: [], goodwillDiscounts: [] },
  });
  await ctx.db.insert("orderPayments", { orderId, method: "card", amount: 690000, idempotencyKey: "pay:gold", createdAt: now, createdBy });
  return orderId;
}

// ─── Visit and mixed-tender receipts (the PR #93 round-1 audit's seeds) ────────────────────────
// A ฿1,200 Thai massage paid ฿500 by voucher and ฿700 by card: a walk-in (its voucher still valid or
// since expired), an attached visit or one linked after the sale; and a ฿0 visit covered by a package session.

const VISIT_PRICE = 120000;
const visitSnapshot = (label: string, amount: number): Snapshot => ({
  label, settingsRevision: 0, terms, ...allocation(amount), contents: [], chosenVariants: [], goodwillDiscounts: [],
});

export type ReturnsVariant = "mixed" | "expired" | "twoExpired" | "visit" | "linked" | "covered";

async function seedVisitVariant(ctx: MutationCtx, variant: ReturnsVariant, createdBy: string): Promise<Id<"orders">> {
  const now = Date.now();
  const covered = variant === "covered";
  const orderId = await ctx.db.insert("orders", {
    orderNumber: 1043, receiptNumber: 2043, currency: "THB", status: "paid", itemCount: 1, hasItems: true,
    total: covered ? 0 : VISIT_PRICE, due: 0, revision: 1, paidAt: now, createdBy, createdAt: now, updatedAt: now, vatVersion: 2,
  });
  const staffId = await ctx.db.insert("staff", { name: "Mali", role: "Therapist", color: "#abc", status: "active", workingHours: [], breaks: [], createdAt: now, updatedAt: now });
  const serviceId = await ctx.db.insert("services", {
    slug: "thai", name: "Thai massage", description: "", category: "Wellness", durationMin: 60, bufferMin: 0,
    price: VISIT_PRICE, currency: "THB", staffIds: [staffId], status: "active", createdAt: now, updatedAt: now,
  });
  const amount = covered ? 0 : VISIT_PRICE;
  const appointmentId = variant === "mixed" || variant === "expired" || variant === "twoExpired" ? null : await ctx.db.insert("appointments", {
    staffId, serviceId, amountPaid: amount, amountRefunded: 0, serviceNameSnapshot: "Thai massage", staffNameSnapshot: "Mali",
    paidAt: now, paidBy: EMAILS.manager, paymentStatus: "paid", price: amount, currency: "THB", status: "completed",
    start: now - DAY, end: now - DAY + 3_600_000, blockedUntil: now - DAY + 3_600_000,
    guestName: "Maya Lin", guestPhone: "", guestPhoneDigits: "", source: "admin",
    confirmationCode: "test-visit", accessToken: "test-access", createdAt: now, revision: 4,
  });
  const attached = variant === "visit" || covered;
  const lineId = await ctx.db.insert("orderLines", {
    orderId, kind: attached ? "appointment" : "service", name: "Thai massage", qty: 1, unitPrice: amount, catalogUnitPrice: amount, currency: "THB", createdAt: now,
    serviceId, ...(attached && appointmentId ? { appointmentId } : {}), saleSnapshot: visitSnapshot("Thai massage", amount),
  });
  if (variant === "linked" && appointmentId) await ctx.db.insert("orderLineLinks", {
    orderId, lineId, appointmentId, kind: "appointment", status: "active", amount, currency: "THB", effectiveAt: now, linkedAt: now, linkedBy: createdBy, reason: "Match visit", sequence: 1,
  });
  const branchId = await ctx.db.insert("branches", { key: "default" });
  if (covered && appointmentId) {
    const ownerId = await ctx.db.insert("customers", { name: "Maya Lin", createdBy, createdAt: now, updatedAt: now });
    const packageId = await ctx.db.insert("packages", { name: "Thai", status: "active", sort: 0, revision: 0 });
    const packageVersionId = await ctx.db.insert("packageVersions", { packageId, version: 1, name: "Thai", price: VISIT_PRICE, validityDays: 365, allowTransfer: false, contents: [], estimatedSplit: [] });
    const expiresAt = now + DAY;
    const grantId = await ctx.db.insert("sessionGrants", {
      ownerId, branchId, orderId, lineId, contentKey: "thai", packageVersionId, total: 1, used: 1, paidUnits: 0, goodwillUnits: 0, returnedUnits: 0,
      paidShare: VISIT_PRICE, expiresAt, issuedTerms: { expiresAt, serviceIds: [serviceId], allowTransfer: false }, settingsRevision: 0, terms, grantServiceIds: [], revision: 4,
    });
    const projection = await ctx.db.insert("grantServices", { grantId, ownerId, serviceId, branchId, usable: false, expiresAt });
    await ctx.db.patch(grantId, { grantServiceIds: [projection] });
    const useId = await ctx.db.insert("sessionUses", {
      grantId, lineId, serviceId, activeAppointmentId: appointmentId, beneficiaryId: ownerId, kind: "use", bucket: "paid", sourceKey: "thai-use", createdAt: now - 1000, actor: createdBy,
      before: { paid: 1, goodwill: 0 }, after: { paid: 0, goodwill: 0 }, guestFact: "Used for visit",
    });
    await ctx.db.patch(appointmentId, { attendeeId: ownerId, coverage: { grantId, useId, priceBefore: VISIT_PRICE } });
    await ctx.db.patch(lineId, { coverage: { grantId, useId, priceBefore: VISIT_PRICE, attendeeId: ownerId } });
    return orderId;
  }
  // "expired": the ฿500 voucher ran out after the sale, so its refund goes onto a new one.
  // "twoExpired": ฿250 each on two vouchers (ending Q9XD and R8TB), both since expired: two equal replacements.
  const voucherEnds = variant === "expired" || variant === "twoExpired" ? now - DAY : now + DAY;
  const codes = variant === "twoExpired" ? [["GV-7KQ2-Q9XD", "GV-••••-Q9XD"], ["GV-3HW5-R8TB", "GV-••••-R8TB"]] : [["GV-7KQ2-Q9XD", "GV-••••-Q9XD"]];
  const each = 50000 / codes.length;
  const cells: { kind: "voucher"; voucherId: Id<"vouchers">; amount: number }[] = [];
  for (const [index, [code, mask]] of codes.entries()) {
    const voucherId = await ctx.db.insert("vouchers", {
      faceValue: each, paidBalance: 0, goodwillBalance: 0, issuedExpiresAt: voucherEnds, effectiveExpiresAt: voucherEnds, status: "active", branchId,
      source: { kind: "sale", orderId, lineId }, revision: 0, settingsRevision: 0, terms,
    });
    const codeId = await ctx.db.insert("voucherCodes", { voucherId, code, mask, status: "active" });
    await ctx.db.patch(voucherId, { activeCodeId: codeId });
    await ctx.db.insert("orderPayments", { orderId, method: "voucher", voucherId, amount: each, idempotencyKey: `voucher-pay-${index}`, createdAt: now, createdBy });
    cells.push({ kind: "voucher", voucherId, amount: each });
  }
  await ctx.db.patch(lineId, { saleSnapshot: { ...visitSnapshot("Thai massage", VISIT_PRICE), tenderCells: [...cells, { kind: "external", amount: 70000 }] } });
  await ctx.db.insert("orderPayments", { orderId, method: "card", amount: 70000, idempotencyKey: "card-pay", createdAt: now, createdBy });
  return orderId;
}

/** One isolated database per fixture session; every call names who makes it (two screens, one database). */
export async function createFixtureBackend(options: { variant?: ReturnsVariant } = {}) {
  const t = convexTest(schema, import.meta.glob("../../convex/**/*.ts"));
  const identity = (who: HarnessRole) => ({ email: EMAILS[who], emailVerified: true, tokenIdentifier: `https://test.clerk.dev|${EMAILS[who]}` });
  const orderId = await t.run(async (ctx) => {
    const now = Date.now();
    for (const who of ["manager", "cashier"] as const) {
      await ctx.db.insert("staffGrants", { role: who, email: EMAILS[who], tokenIdentifier: identity(who).tokenIdentifier, revision: 1, createdAt: now, updatedAt: now, updatedByEmail: "system:seed" });
    }
    const createdBy = identity("cashier").tokenIdentifier;
    return options.variant ? await seedVisitVariant(ctx, options.variant, createdBy) : await seedGold(ctx, createdBy);
  });
  const as = (who: HarnessRole) => t.withIdentity(identity(who));
  return {
    orderId: () => orderId,
    query: (who: HarnessRole, name: string, args: Record<string, unknown>) => as(who).query(makeFunctionReference<"query">(name), args),
    mutation: (who: HarnessRole, name: string, args: Record<string, unknown>) => as(who).mutation(makeFunctionReference<"mutation">(name), args),
    /** What the server recorded, for assertions. */
    returns: () => t.run((ctx) => ctx.db.query("orderReturns").take(10)),
    payouts: () => t.run((ctx) => ctx.db.query("returnPayouts").take(10)),
    stock: () => t.run(async (ctx) => (await ctx.db.query("stockLevels").take(1))[0]?.onHand ?? null),
    /** Payments on attempts since cutover revision 1, as on the live resort (once per database). */
    attempts: () => t.run(async (ctx) => {
      if (await ctx.db.query("commerceSettings").first()) return null;
      const now = Date.now();
      await ctx.db.insert("commerceSettings", {
        key: "default", ...settings, paymentsMode: "attempts", revision: 1,
        cutover: { pausedAt: now - 60_000, activatedAt: now, actor: "owner", revision: 1 },
      });
      return null;
    }),
  };
}
