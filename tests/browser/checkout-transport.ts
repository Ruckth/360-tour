import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "convex/_generated/api";
import type {
  CheckoutActions,
  CheckoutBackend,
} from "@/components/checkout/backend";
import type { createFixtureBackend as createServerBackend } from "../support/checkout-backend";
type ServerBackend = Awaited<ReturnType<typeof createServerBackend>>;
async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/__checkout-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.data !== undefined) throw new ConvexError(result.data);
    throw new Error(result.message);
  }
  return result.value;
}
export async function createFixtureBackend(
  options: Parameters<typeof createServerBackend>[0] = {},
) {
  const session = await post<string>({ kind: "create", options });
  let role = options.staff?.role ?? "owner";
  const call = <T>(method: string, args: unknown[]) =>
    post<T>({ kind: "call", session, method, args });
  type Q = FunctionReference<"query">;
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
  const cache = new Map<
    string,
    { ref: Q; args: Record<string, unknown>; value: unknown; error?: unknown }
  >();
  async function load(entry: ReturnType<typeof cache.get>) {
    if (!entry) return;
    try {
      entry.value = await call("readFixtureQuery", [
        getFunctionName(entry.ref),
        entry.args,
      ]);
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
        void load(entry).then(notify);
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
    Object.keys(refs).map((key) => [
      key,
      async (args: unknown) => {
        const result = await call("action:" + key, [args]);
        await refresh();
        return result;
      },
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
      useRead(api.pos.staffApprovals.pending, role === "cashier" ? "skip" : {}),
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
  return Object.assign(backend, {
    async setStaff(next: Parameters<ServerBackend["setStaff"]>[0]) {
      await call("setStaff", [next]);
      role = next.role;
      await refresh();
    },
    seedApproval: (...args: Parameters<ServerBackend["seedApproval"]>) =>
      call<Awaited<ReturnType<ServerBackend["seedApproval"]>>>(
        "seedApproval",
        args,
      ),
    setCouponSnapshot: (
      ...args: Parameters<ServerBackend["setCouponSnapshot"]>
    ) => call("setCouponSnapshot", args),
    setAppointmentSnapshot: (
      ...args: Parameters<ServerBackend["setAppointmentSnapshot"]>
    ) => call("setAppointmentSnapshot", args),
    recordedRefunds: () =>
      call<Awaited<ReturnType<ServerBackend["recordedRefunds"]>>>(
        "recordedRefunds",
        [],
      ),
    refundAttempts: () =>
      call<ReturnType<ServerBackend["refundAttempts"]>>("refundAttempts", []),
    loseNextRefundResponse: () => call("loseNextRefundResponse", []),
    async refundFromAnotherTill(lineName: string, satang: number) {
      await call("refundFromAnotherTill", [lineName, satang]);
    },
  });
}
