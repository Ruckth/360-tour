import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { cutoverAccess, payDeskCommerce, withSwapOwner, type PayDeskTransport } from "@/components/checkout/pay-desk-backend";
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
  /** Keep the same database across page reloads (tab-scoped), for reload and resume checks. */
  reuse?: { key: string },
) {
  const kept = reuse ? sessionStorage.getItem(reuse.key) : null;
  const session = kept ?? await post<string>({ kind: "create", options });
  if (reuse) sessionStorage.setItem(reuse.key, session);
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
      // No connection (fetch failed): keep the last answer, as the live client does while offline.
      if (e instanceof TypeError) return;
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
    args: Omit<FunctionArgs<R>, "paginationOpts"> | "skip",
  ) {
    const key = JSON.stringify([getFunctionName(ref), args]);
    const [state, setState] = useState({
      key,
      cursor: null as string | null,
      older: [] as unknown[],
    });
    const active = state.key === key ? state : { key, cursor: null, older: [] };
    const value = useRead(ref, args === "skip" ? "skip" : {
      ...args,
      paginationOpts: { numItems: 20, cursor: active.cursor },
    } as FunctionArgs<R>) as
      | { page: unknown[]; isDone: boolean; continueCursor: string }
      | undefined;
    return {
      results: [...active.older, ...(value?.page ?? [])],
      status:
        args === "skip"
          ? ("Exhausted" as const)
          : value === undefined
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
  const swapEdits = new Set<keyof typeof refs>([
    "addAppointmentFee", "addItem", "attach", "updateLine", "overrideLinePrice", "removeLine", "updateSourceLine",
    "linkCustomer", "unlinkCustomer", "saveOrder", "applyOrderCoupon", "removeOrderCoupon", "recheckOrderCoupon",
  ]);
  const actions = Object.fromEntries(
    (Object.keys(refs) as (keyof typeof refs)[]).map((key) => {
      async function mutate(args: { swapOwner?: { tillId: string; tabKey?: string } }) {
        const result = await call("action:" + key, [args]);
        await refresh();
        return result;
      }
      return [key, swapEdits.has(key) ? withSwapOwner(mutate) : mutate];
    }),
  ) as unknown as CheckoutActions;
  const backend: CheckoutBackend = {
    useActions: () => actions,
    useCatalog: () => {
      const items = useRead(api.pos.catalog.stableCatalog, {});
      const frequent = useRead(api.pos.catalog.recentCatalogRanking, {});
      return useMemo(() => items === undefined || frequent === undefined ? undefined : { ...items, frequent }, [items, frequent]);
    },
    useOrder: (id) =>
      useRead(api.pos.orders.getOrder, id ? { orderId: id } : "skip"),
    useRestoreCheck: (id) =>
      useRead(api.pos.orders.restoreCheck, { orderId: id }),
    useAppointmentFees: (id) =>
      useRead(api.pos.orders.appointmentFees, { appointmentId: id }),
    useOrderApprovals: (id) =>
      useRead(api.pos.staffApprovals.forOrder, id ? { orderId: id } : "skip"),
    usePendingApprovals: () =>
      // Only approvers read the queue (a cashier is refused), as the live backend skips it.
      usePage(api.pos.staffApprovals.pendingPage, role === "cashier" ? "skip" : {}) as ReturnType<CheckoutBackend["usePendingApprovals"]>,
    useApprovalDetail: (requestId) =>
      useRead(api.pos.staffApprovals.detail, requestId ? { requestId } : "skip"),
    useFindOrder: (n, receipt) =>
      useRead(
        api.pos.orders.findOrderByNumber,
        n === null ? "skip" : { orderNumber: n, receipt },
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
    useOpenOrders: () => usePage(api.pos.orders.listOpenOrders, {}) as ReturnType<CheckoutBackend["useOpenOrders"]>,
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
  // The pay desk over the same database, wired as the live checkout wires it.
  const lost = new Set<string>();
  const first = new Set<string>();
  const payTransport: PayDeskTransport = {
    useMutation: (ref) => async (args) => {
      const name = getFunctionName(ref);
      // Another tab on this till sent the identical call a moment earlier (a race).
      if (first.delete(name)) await call("runFixtureMutation", [name, args]);
      const result = await call("runFixtureMutation", [name, args]);
      await refresh();
      if (lost.delete(name)) throw new Error("Connection lost");
      return result as never;
    },
    useQuery: useRead,
  };
  backend.commerce = payDeskCommerce(payTransport, cutoverAccess(payTransport));
  return Object.assign(backend, {
    /** True when this page reopened an existing fixture database (a reload). */
    reused: kept !== null,
    async setCommerceSettings(patch: Parameters<ServerBackend["setCommerceSettings"]>[0]) {
      await call("setCommerceSettings", [patch]);
      await refresh();
    },
    runFixtureMutation: async (...args: Parameters<ServerBackend["runFixtureMutation"]>) => {
      const result = await call("runFixtureMutation", args);
      await refresh();
      return result;
    },
    insertFixtureRows: async (...args: Parameters<ServerBackend["insertFixtureRows"]>) => { await call("insertFixtureRows", args); await refresh(); },
    patchFixtureRow: async (...args: Parameters<ServerBackend["patchFixtureRow"]>) => { await call("patchFixtureRow", args); await refresh(); },
    fixtureRows: (...args: Parameters<ServerBackend["fixtureRows"]>) => call<Record<string, unknown>[]>("fixtureRows", args),
    /** The next answer from this function is lost after it commits, like a dropped connection. */
    loseNextAnswer: (name: string) => { lost.add(name); },
    /** Another tab on this till sends the panel's next call to this function just before it does. */
    raceNextCall: (name: string) => { first.add(name); },
    async setStaff(next: Parameters<ServerBackend["setStaff"]>[0]) {
      await call("setStaff", [next]);
      role = next.role;
      await refresh();
    },
    seedApproval: async (...args: Parameters<ServerBackend["seedApproval"]>) => {
      const result = await call<Awaited<ReturnType<ServerBackend["seedApproval"]>>>("seedApproval", args);
      await refresh();
      return result;
    },
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
      // Keep the local view stale until the spec explicitly refreshes it (setStaff).
      // This lets refund-cap tests exercise the server after an unseen payment at another till.
      await call("refundFromAnotherTill", [lineName, satang]);
    },
  });
}
