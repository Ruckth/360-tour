/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import schema from "../../convex/schema";
import { api } from "convex/_generated/api";
import type { Doc, Id, TableNames } from "convex/_generated/dataModel";
import type { CashierRules, ApprovalPayload } from "convex/shared/staffTypes";
import type { CouponRules } from "convex/shared/offers";
import type {
  CheckoutBackend,
  CheckoutActions,
  OrderView,
  FinancialRows,
  FinancialStream,
} from "@/components/checkout/backend";
import type { FixtureBooking, FixtureAppointment } from "./checkout-data";
import { checkoutSeed } from "./checkout-seed";
import { CATALOG } from "./checkout-data";
import { track } from "./checkout-act";

export type FixtureStaff = {
  role: "owner" | "manager" | "cashier";
  email: string;
  rules?: CashierRules;
};
type Options = {
  bookings?: Partial<FixtureBooking>[];
  appointments?: Partial<FixtureAppointment>[];
  appointmentRefunds?: Doc<"appointmentRefunds">[];
  financialHistory?: Partial<{ [K in FinancialStream]: FinancialRows[K][] }>;
  recordedRefunds?: (OrderView["refunds"][number] & {
    orderId: Id<"orders">;
  })[];
  staff?: FixtureStaff;
};
/** DOM interaction tests use the registered backend implementation, never a money/business simulator.
 * Alias translation preserves readable old fixture identities; only the real database generates IDs.
 * This in-process harness is separate from the signed-JWT local-server browser acceptance suite.
 */
export async function createFixtureBackend(options: Options = {}) {
  const t = convexTest(schema, import.meta.glob("../../convex/**/*.ts"));
  const aliases = new Map<string, string>();
  const data = await t.run((ctx) => checkoutSeed(ctx, aliases));
  let staff: FixtureStaff = options.staff ?? {
    role: "owner",
    email: "preview@example.com",
  };
  const identity = () => ({
    email: staff.email,
    tokenIdentifier: `https://test.clerk.dev|${staff.email}`,
  });
  // A seed grants only this synthetic test identity. Production authorization code is unchanged.
  async function grant() {
    await t.run(async (ctx) => {
      const old = await ctx.db
        .query("staffGrants")
        .withIndex("by_email", (q) => q.eq("email", staff.email))
        .unique();
      const fields = {
        email: staff.email,
        tokenIdentifier: identity().tokenIdentifier,
        role: staff.role === "owner" ? ("manager" as const) : staff.role,
        revision: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedByEmail: "system:seed",
      };
      if (old) {
        if (
          old.role !== fields.role ||
          old.tokenIdentifier !== fields.tokenIdentifier
        )
          await ctx.db.patch(old._id, fields);
      } else await ctx.db.insert("staffGrants", fields);
      if (staff.rules) {
        const row = await ctx.db.query("cashierRules").first();
        if (row) await ctx.db.patch(row._id, staff.rules);
      }
    });
  }
  await grant();
  const translate = (value: unknown, reverse = false): unknown => {
    if (typeof value === "string")
      return reverse
        ? ([...aliases].find(([, id]) => id === value)?.[0] ?? value)
        : (aliases.get(value) ?? value);
    if (Array.isArray(value))
      return value.map((item) => translate(item, reverse));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, translate(v, reverse)]),
      );
    return value;
  };
  let version = 0;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const notify = () => {
    version++;
    for (const fn of listeners) fn();
  };
  type Q = FunctionReference<"query">;
  const cache = new Map<
    string,
    { ref: Q; args: Record<string, unknown>; value: unknown; error?: unknown }
  >();
  async function load(entry: ReturnType<typeof cache.get>) {
    if (!entry) return;
    try {
      entry.value = translate(
        await t
          .withIdentity(identity())
          .query(entry.ref, translate(entry.args) as FunctionArgs<Q>),
        true,
      );
      if (getFunctionName(entry.ref) === "pos/catalog:catalog")
        entry.value = {
          ...(entry.value as object),
          extras: CATALOG.extras,
          frequent: CATALOG.frequent,
        };
      entry.error = undefined;
    } catch (e) {
      entry.error = e;
    }
  }
  async function refresh() {
    await Promise.all([...cache.values()].map(load));
    notify();
  }
  function useRead<R extends Q>(
    ref: R,
    args: FunctionArgs<R> | "skip",
  ): FunctionReturnType<R> | undefined {
    useSyncExternalStore(
      subscribe,
      () => version,
      () => version,
    );
    const key =
      args === "skip" ? "" : JSON.stringify([getFunctionName(ref), args]);
    let entry = cache.get(key);
    if (key && !entry && args !== "skip") {
      entry = { ref, args, value: undefined };
      cache.set(key, entry);
    }
    useEffect(() => {
      if (entry && entry.value === undefined && !entry.error)
        void track(load(entry).then(notify));
    }, [entry]);
    if (entry?.error) throw entry.error;
    return entry?.value as FunctionReturnType<R> | undefined;
  }
  function usePage<R extends Q>(
    ref: R,
    args: Omit<FunctionArgs<R>, "paginationOpts">,
  ) {
    const key = JSON.stringify([getFunctionName(ref), args]);
    const [state, setState] = useState({
      key,
      cursor: null as string | null,
      older: [] as unknown[],
    });
    const active = state.key === key ? state : { key, cursor: null, older: [] };
    const value = useRead(ref, {
      ...args,
      paginationOpts: { numItems: 20, cursor: active.cursor },
    } as FunctionArgs<R>) as
      | { page: unknown[]; isDone: boolean; continueCursor: string }
      | undefined;
    return {
      results: [...active.older, ...(value?.page ?? [])],
      status:
        value === undefined
          ? active.older.length
            ? ("LoadingMore" as const)
            : ("LoadingFirstPage" as const)
          : value.isDone
            ? ("Exhausted" as const)
            : ("CanLoadMore" as const),
      loadMore: () => {
        if (value && !value.isDone)
          setState({
            key,
            cursor: value.continueCursor,
            older: [...active.older, ...value.page],
          });
      },
    };
  }
  const refundAttempts: Parameters<CheckoutActions["refundLine"]>[0][] = [];
  let loseRefund = false;
  const refs = {
    noteCouponRefusal: api.marketing.report.noteCouponRefusal,
    discardOrder: api.pos.commands.discardOrder.discardOrder,
    restoreOrder: api.pos.commands.restoreOrder.restoreOrder,
    addAppointmentFee: api.pos.commands.addAppointmentFee.addAppointmentFee,
    openOrderFor: api.pos.commands.openOrderForLink.openOrderForLink,
    addItem: api.pos.commands.addItem.addItem,
    attach: api.pos.commands.attach.attach,
    updateLine: api.pos.commands.updateLine.updateLine,
    overrideLinePrice: api.pos.commands.overrideLinePrice.overrideLinePrice,
    removeLine: api.pos.commands.removeLine.removeLine,
    updateSourceLine: api.pos.commands.updateSourceLine.updateSourceLine,
    linkCustomer: api.pos.commands.linkCustomer.linkCustomer,
    unlinkCustomer: api.pos.commands.unlinkCustomer.unlinkCustomer,
    saveOrder: api.pos.commands.saveOrder.saveOrder,
    clearOrder: api.pos.commands.clearOrder.clearOrder,
    settleOrder: api.pos.commands.settleOrder.settleOrder,
    amendOrderPayment: api.pos.commands.amendOrderPayment.amendOrderPayment,
    voidUnreceivedOrder:
      api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder,
    linkPaidLine: api.pos.commands.linkPaidLine.linkPaidLine,
    unlinkPaidLine: api.pos.commands.unlinkPaidLine.unlinkPaidLine,
    refundLine: api.pos.commands.refundLine.refundLine,
    resumeCustomerMerge: api.pos.customers.resumeCustomerMerge,
    voidOrder: api.pos.commands.voidOrder.voidOrder,
    applyOrderCoupon: api.pos.commands.applyOrderCoupon.applyOrderCoupon,
    removeOrderCoupon: api.pos.commands.removeOrderCoupon.removeOrderCoupon,
    recheckOrderCoupon: api.pos.commands.recheckOrderCoupon.recheckOrderCoupon,
    createCustomer: api.pos.customers.createCustomer,
    updateCustomer: api.pos.customers.updateCustomer,
    setCustomerArchived: api.pos.customers.setCustomerArchived,
    mergeCustomers: api.pos.customers.mergeCustomers,
    createOrder: api.pos.commands.createOrder.createOrder,
    createApproval: api.pos.staffApprovals.create,
    approveApproval: api.pos.staffApprovals.approve,
    rejectApproval: api.pos.staffApprovals.reject,
    cancelApproval: api.pos.staffApprovals.cancel,
  };
  const actions = Object.fromEntries(
    Object.entries(refs).map(([key, ref]) => [
      key,
      (args: Record<string, unknown>) =>
        track(
          (async () => {
            if (key === "refundLine")
              refundAttempts.push(
                args as Parameters<CheckoutActions["refundLine"]>[0],
              );
            const result = await t
              .withIdentity(identity())
              .mutation(
                ref as FunctionReference<"mutation">,
                translate(args) as Record<string, unknown>,
              );
            await refresh();
            if (key === "refundLine" && loseRefund) {
              loseRefund = false;
              throw new Error("Connection lost. Try again.");
            }
            return translate(result, true);
          })(),
        ),
    ]),
  ) as unknown as CheckoutActions;
  const backend: CheckoutBackend = {
    useActions: () => actions,
    useCatalog: () => useRead(api.pos.catalog.catalog, {}),
    useOrder: (id) =>
      useRead(api.pos.orders.getOrder, id ? { orderId: id } : "skip"),
    useRestoreCheck: (id) =>
      useRead(api.pos.orders.restoreCheck, { orderId: id }),
    useAppointmentFees: (id) =>
      useRead(api.pos.orders.appointmentFees, { appointmentId: id }),
    useOrderApprovals: (id) =>
      useRead(api.pos.staffApprovals.forOrder, id ? { orderId: id } : "skip"),
    usePendingApprovals: () =>
      useRead(
        api.pos.staffApprovals.pending,
        staff.role === "cashier" ? "skip" : {},
      ),
    useFindOrder: (n) =>
      useRead(
        api.pos.orders.findOrderByNumber,
        n === null ? "skip" : { orderNumber: n },
      ),
    useBusinessName: () =>
      useRead(api.settings.settings.publicProfile, {})?.businessName,
    useCustomerSearch: (query) =>
      useRead(
        api.pos.customers.searchCustomers,
        query.trim().length < 2 ? "skip" : { query },
      ),
    useCustomer: (id) =>
      useRead(api.pos.customers.getCustomer, { customerId: id }),
    useAttachable: ({ orderId, query }) =>
      useRead(api.pos.sourceReads.listAttachable, {
        orderId: orderId ?? undefined,
        query: query || undefined,
      }),
    useAttachLookupStatus: ({ orderId, query }) =>
      useRead(api.pos.sourceReads.attachLookupStatus, {
        orderId: orderId ?? undefined,
        query: query || undefined,
      }),
    useLinkCandidates: ({ orderId, lineId, query }) =>
      useRead(api.pos.sourceReads.linkCandidates, {
        orderId,
        lineId,
        query: query || undefined,
      }),
    useOrders: (filter) =>
      usePage(api.pos.orders.listOrders, { filter }) as ReturnType<
        CheckoutBackend["useOrders"]
      >,
    useOrderHistory: (orderId) =>
      usePage(api.pos.orders.orderHistory, { orderId }) as ReturnType<
        CheckoutBackend["useOrderHistory"]
      >,
    useCustomerPage: (query, archived) =>
      usePage(api.pos.customers.browseCustomers, {
        query,
        archived,
      }) as ReturnType<CheckoutBackend["useCustomerPage"]>,
    useCustomerHistory: (customerId) =>
      usePage(api.pos.customers.customerHistory, { customerId }) as ReturnType<
        CheckoutBackend["useCustomerHistory"]
      >,
    useCustomerOrders: (customerId) =>
      usePage(api.pos.customers.listCustomerOrders, {
        customerId,
      }) as ReturnType<CheckoutBackend["useCustomerOrders"]>,
    useCorrectionHistory: (orderId) =>
      usePage(api.pos.orderHistoryPages.corrections, { orderId }) as ReturnType<
        CheckoutBackend["useCorrectionHistory"]
      >,
    useAuditHistory: (orderId) =>
      usePage(api.pos.orderHistoryPages.audit, { orderId }) as ReturnType<
        CheckoutBackend["useAuditHistory"]
      >,
    useBookingRefundHistory: (orderId) =>
      usePage(api.pos.orderHistoryPages.bookingRefunds, {
        orderId,
      }) as ReturnType<CheckoutBackend["useBookingRefundHistory"]>,
    useAppointmentRefundHistory: (orderId) =>
      usePage(api.pos.orderHistoryPages.appointmentRefunds, {
        orderId,
      }) as ReturnType<CheckoutBackend["useAppointmentRefundHistory"]>,
    useOrderRefundHistory: (orderId) =>
      usePage(api.pos.orderHistoryPages.orderRefunds, {
        orderId,
      }) as ReturnType<CheckoutBackend["useOrderRefundHistory"]>,
  };
  const imported = new Set<string>();
  async function importHistory() {
    await t.run(async (ctx) => {
      async function insert<T extends TableNames>(table: T, source: object) {
        const row = source as Record<string, unknown>;
        const alias = String(row._id);
        if (imported.has(alias)) return;
        const fields = Object.fromEntries(
          Object.entries(row).filter(
            ([key]) => !["_id", "_creationTime", "sourceType"].includes(key),
          ),
        );
        if (
          typeof fields.orderId === "string" &&
          !aliases.has(fields.orderId) &&
          !ctx.db.normalizeId("orders", fields.orderId)
        ) {
          aliases.set(
            fields.orderId,
            await ctx.db.insert("orders", {
              status: "draft",
              orderNumber: 1044,
              currency: "THB",
              itemCount: 0,
              total: 0,
              due: 0,
              hasItems: false,
              revision: 0,
              createdBy: "system:seed",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }),
          );
        }
        if (table === "bookingRefunds")
          Object.assign(fields, {
            netBefore: 0,
            netAfter: 0,
            idempotencyKey: alias,
            context: "credit",
            ...fields,
          });
        const id = await ctx.db.insert(
          table,
          translate(fields) as Parameters<typeof ctx.db.insert<T>>[1],
        );
        aliases.set(alias, id);
        imported.add(alias);
      }
      for (const row of options.financialHistory?.corrections ?? [])
        await insert("orderCorrections", row);
      for (const row of options.financialHistory?.audit ?? [])
        await insert("orderAudit", row);
      for (const row of options.financialHistory?.bookingRefunds ?? [])
        await insert("bookingRefunds", row);
      for (const row of [
        ...(options.appointmentRefunds ?? []),
        ...(options.financialHistory?.appointmentRefunds ?? []),
      ])
        await insert("appointmentRefunds", row);
      for (const row of options.recordedRefunds ?? [])
        await insert(
          row.sourceType === "appointment"
            ? "appointmentRefunds"
            : "bookingRefunds",
          row,
        );
    });
  }
  await importHistory();
  async function setAppointmentSnapshot(
    id: Id<"appointments">,
    patch: Partial<FixtureAppointment>,
  ) {
    await t.run(async (ctx) => {
      const row = await ctx.db.get(translate(id) as Id<"appointments">);
      if (!row) throw new Error("Missing fixture appointment");
      const old = data.appointments.find((row) => row.appointmentId === id);
      if (old) Object.assign(old, patch);
      const {
        price,
        start,
        status,
        revision,
        amountPaid,
        amountRefunded,
        paid,
      } = patch;
      await ctx.db.patch(row._id, {
        ...(price !== undefined ? { price } : {}),
        ...(start !== undefined
          ? {
              start,
              end: start + (row.end - row.start),
              blockedUntil: start + (row.blockedUntil - row.start),
            }
          : {}),
        ...(status ? { status } : {}),
        ...(revision !== undefined ? { revision } : {}),
        ...(amountPaid !== undefined ? { amountPaid } : {}),
        ...(amountRefunded !== undefined ? { amountRefunded } : {}),
        ...(paid !== undefined
          ? { paymentStatus: paid ? ("paid" as const) : ("unpaid" as const) }
          : {}),
      });
    });
    await importHistory();
    await refresh();
  }
  async function setBookingSnapshot(
    id: Id<"bookings">,
    patch: Partial<FixtureBooking>,
  ) {
    await t.run(async (ctx) => {
      const row = await ctx.db.get(translate(id) as Id<"bookings">);
      if (!row) throw new Error("Missing fixture booking");
      if (patch.promotion) {
        const coupon = await ctx.db
          .query("coupons")
          .withIndex("by_code", (q) => q.eq("code", patch.promotion!.code))
          .unique();
        if (!coupon) throw new Error("Missing seeded coupon");
        const redemptionId = await ctx.db.insert("couponRedemptions", {
          couponId: coupon._id,
          couponVersion: coupon.currentVersion,
          code: coupon.code,
          bookingId: row._id,
          state: "consumed",
          discount: patch.promotion.discount,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.patch(row._id, {
          promotion: {
            couponId: coupon._id,
            couponVersion: coupon.currentVersion,
            redemptionId,
            ...patch.promotion,
          },
        });
      }
      await ctx.db.patch(row._id, {
        ...(patch.deposit !== undefined ? { amountPaid: patch.deposit } : {}),
        ...(patch.price !== undefined
          ? { total: patch.price, subtotal: patch.price }
          : {}),
        ...(patch.providerRefundWaived !== undefined
          ? { providerRefundWaived: patch.providerRefundWaived }
          : {}),
        ...(patch.checkoutInProgress !== undefined
          ? {
              stripeCheckoutExpiresAt: patch.checkoutInProgress
                ? Date.now() + 86400000
                : undefined,
              stripeCheckoutSessionId: patch.checkoutInProgress
                ? "cs_test_local_fixture"
                : undefined,
            }
          : {}),
        ...(patch.paid !== undefined
          ? {
              paymentStatus: patch.paid
                ? ("paid" as const)
                : ("pending" as const),
              amountPaid: patch.paid
                ? row.total
                : (patch.deposit ?? row.amountPaid),
            }
          : {}),
      });
    });
    await refresh();
  }
  for (const patch of options.appointments ?? [])
    if (patch.appointmentId)
      await setAppointmentSnapshot(patch.appointmentId, patch);
  for (const patch of options.bookings ?? [])
    if (patch.id) await setBookingSnapshot(patch.id, patch);
  return Object.assign(backend, {
    setAppointmentSnapshot,
    setBookingSnapshot,
    async readFixtureQuery(name: string, args: Record<string, unknown>) {
      return translate(
        await t
          .withIdentity(identity())
          .query(
            makeFunctionReference<"query">(name),
            translate(args) as Record<string, unknown>,
          ),
        true,
      );
    },
    async setCouponSnapshot(code: string, patch: Partial<CouponRules>) {
      await t.run(async (ctx) => {
        const coupon = await ctx.db
          .query("coupons")
          .withIndex("by_code", (q) => q.eq("code", code))
          .unique();
        if (!coupon) throw new Error("Missing fixture coupon");
        const { used, discountGranted, status, ...rules } = patch;
        if (
          used !== undefined ||
          discountGranted !== undefined ||
          status !== undefined
        )
          await ctx.db.patch(coupon._id, {
            ...(status !== undefined ? { status } : {}),
            ...(used !== undefined ? { used } : {}),
            ...(discountGranted !== undefined ? { discountGranted } : {}),
          });
        const version = await ctx.db
          .query("couponVersions")
          .withIndex("by_coupon_and_version", (q) =>
            q.eq("couponId", coupon._id).eq("version", coupon.currentVersion),
          )
          .unique();
        if (version) await ctx.db.patch(version._id, rules);
      });
      await refresh();
    },
    async appointmentSnapshot(id: Id<"appointments">) {
      const row = await t.run((ctx) =>
        ctx.db.get(translate(id) as Id<"appointments">),
      );
      return row
        ? {
            ...data.appointments.find((row) => row.appointmentId === id),
            price: row.price,
            status: row.status,
            paid: row.paymentStatus === "paid",
            amountPaid: row.amountPaid,
            amountRefunded: row.amountRefunded,
          }
        : undefined;
    },
    async setStaff(next: FixtureStaff) {
      staff = next;
      await grant();
      await refresh();
    },
    async seedApproval(request: {
      orderId: Id<"orders">;
      payload: ApprovalPayload;
      reason: string;
      requesterEmail: string;
      createdAt?: number;
    }) {
      const before = staff;
      await this.setStaff({ role: "cashier", email: request.requesterEmail });
      try {
        return await actions.createApproval({
          orderId: request.orderId,
          payload: request.payload,
          reason: request.reason,
        });
      } finally {
        await this.setStaff(before);
      }
    },
    refundAttempts: () => refundAttempts,
    async recordedRefunds() {
      return translate(
        await t.run((ctx) => ctx.db.query("orderRefunds").take(100)),
        true,
      ) as Doc<"orderRefunds">[];
    },
    loseNextRefundResponse: () => {
      loseRefund = true;
    },
    async refundFromAnotherTill(lineName: string, satang: number) {
      const orders = await t.run((ctx) =>
        ctx.db.query("orders").order("desc").take(20),
      );
      const order = orders.find((row) => row.status === "paid");
      if (!order) throw new Error("No paid order");
      const view = await t
        .withIdentity(identity())
        .query(api.pos.orders.getOrder, { orderId: order._id });
      const line = view?.lines.find((row) => row.name === lineName);
      if (!line) throw new Error("No paid line");
      await actions.refundLine({
        orderId: order._id,
        lineId: line._id,
        amount: satang,
        method: "cash",
        reason: "Other till",
        idempotencyKey: crypto.randomUUID(),
        currency: order.currency,
      });
    },
  });
}
