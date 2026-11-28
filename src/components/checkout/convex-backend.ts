"use client";

import { useConvex, useConvexConnectionState, useMutation, usePaginatedQuery, useQueries, useQuery, type RequestForQueries } from "convex/react";
import { api } from "convex/_generated/api";
import type { PaginationResult } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { returnArgs, type AdjustTarget, type ApprovalQueueStatus, type CheckoutBackend, type CommerceBackend, type CustomerPage, type HistoryAudience, type HistoryEntry, type ReturnsDesk, type ReturnLotsLookup, type ApprovalId } from "./backend";
import { cutoverAccess, payDeskCommerce, type PayDeskTransport, withSwapOwner } from "./pay-desk-backend";

const SKIP = "skip" as const;
const NOTHING_TO_LOAD = { results: [], status: "Exhausted" as const, loadMore: () => {} };
/** Cashiers may only search active customers by at least two characters (customers.browseCustomers). */
const cashierCannotBrowse = (query: string, archived: boolean) => archived || query.trim().length < 2;

type HistoryCursorSlot = { cursor: string | null; endCursor?: string };
type StaffHistoryRow = PaginationResult<unknown>["page"][number];
/** The page cursors subscribed now, and how many pages the user has asked for (Load more). */
type HistoryChain = { slots: HistoryCursorSlot[]; depth: number };
const INITIAL_HISTORY_SLOTS: HistoryCursorSlot[] = [{ cursor: null }];
const INITIAL_HISTORY_CHAIN: HistoryChain = { slots: INITIAL_HISTORY_SLOTS, depth: 1 };

function isStaleHistoryCursor(err: Error) {
  if (err.message.includes("InvalidCursor")) return true;
  const data = "data" in err ? (err as { data?: Record<string, unknown> }).data : undefined;
  return data?.code === "STALE_HISTORY_CURSOR" || (data?.isConvexSystemError === true && data?.paginationError === "InvalidCursor");
}

/**
 * The chain's next state, or null when it is aligned. When page i's continueCursor moves (a live
 * insert), page i+1 re-subscribes at the new cursor; once the resolved chain ends short of the
 * pages the user loaded (`depth`), the next page is appended, so every loaded page comes back.
 */
function nextHistoryChain(
  { slots, depth }: HistoryChain,
  raw: Record<string, PaginationResult<StaffHistoryRow> | Error | undefined>,
): HistoryChain | null {
  let last: PaginationResult<StaffHistoryRow> | undefined;
  for (let i = 0; i < slots.length; i++) {
    const res = raw[String(i)];
    if (!res) return null;
    if (res instanceof Error) {
      if (isStaleHistoryCursor(res) && (slots.length > 1 || slots[0].cursor !== null || slots[0].endCursor !== undefined)) {
        return INITIAL_HISTORY_CHAIN;
      }
      return null;
    }
    if (res.pageStatus === "SplitRequired" && res.splitCursor && res.splitCursor !== slots[i].endCursor) {
      const next = [...slots];
      next.splice(i, 1, { cursor: slots[i].cursor, endCursor: res.splitCursor }, { cursor: res.splitCursor, endCursor: res.continueCursor });
      return { slots: next, depth: depth + 1 };
    }
    if (i + 1 < slots.length) {
      if (res.isDone) return { slots: slots.slice(0, i + 1), depth };
      if (res.continueCursor !== slots[i + 1].cursor) {
        return { slots: [...slots.slice(0, i + 1), { cursor: res.continueCursor }], depth };
      }
    }
    last = res;
  }
  return last && !last.isDone && slots.length < depth ? { slots: [...slots, { cursor: last.continueCursor }], depth } : null;
}

/**
 * Reactive cursor-chained History pagination. Unlike usePaginatedQuery, when a live insert shifts
 * page i's continueCursor (including a `cut:` boundary), page i+1 automatically re-subscribes to the
 * new continueCursor so no entry is ever dropped between loaded pages or lost to a stale cursor, and
 * the chain rebuilds to every page the user had loaded.
 */
function useChainedHistory(target: AdjustTarget | null, audience: HistoryAudience) {
  const targetType = target?.targetType;
  const targetId = target?.targetId;
  const isBenefit = targetType === "voucher" || targetType === "grant";
  const active = Boolean(targetType && targetId && (audience === "staff" || isBenefit));
  const streamKey = active ? `${audience}:${targetType}:${targetId}` : "";
  const [state, setState] = useState<{ key: string } & HistoryChain>(() => ({ key: streamKey, ...INITIAL_HISTORY_CHAIN }));
  const sameStream = state.key === streamKey;
  const chain = sameStream ? state : INITIAL_HISTORY_CHAIN;
  const slots = chain.slots;
  // A new target or audience starts its own chain: at most one render-phase update per prop change.
  if (!sameStream) {
    setState({ key: streamKey, ...INITIAL_HISTORY_CHAIN });
  }

  const requests = useMemo(() => {
    if (!active || !targetType || !targetId) return {};
    const targetArg = { targetType, targetId } as AdjustTarget;
    const out: Record<string, { query: typeof api.commerce.history.staffPage | typeof api.commerce.history.guestPage; args: Record<string, unknown> }> = {};
    slots.forEach((slot, index) => {
      const paginationOpts = { numItems: 20, cursor: slot.cursor, ...(slot.endCursor ? { endCursor: slot.endCursor } : {}) };
      out[String(index)] = audience === "guest" && isBenefit
        ? { query: api.commerce.history.guestPage, args: { target: targetArg, paginationOpts } }
        : { query: api.commerce.history.staffPage, args: { target: targetArg, paginationOpts } };
    });
    return out;
  }, [active, audience, isBenefit, slots, targetId, targetType]);

  const raw = useQueries(requests as Parameters<typeof useQueries>[0]) as Record<string, PaginationResult<StaffHistoryRow> | Error | undefined>;

  // Re-align continuation cursors whenever an earlier page's boundary moves under live inserts and
  // rebuild the chain to the loaded depth, or reset on stale cursor. Each step lands after commit,
  // never during render: a rebuild through many cached pages advances one slot per commit instead
  // of nesting render-phase updates past React's limit. A step computed from a chain that has since
  // changed (Load more, another stream) is dropped and recomputed from the new one.
  const adjusted = active && sameStream ? nextHistoryChain(chain, raw) : null;
  useEffect(() => {
    if (!adjusted) return;
    let live = true;
    queueMicrotask(() => {
      if (live) setState((prev) => (prev === chain ? { key: streamKey, ...adjusted } : prev));
    });
    return () => { live = false; };
  }, [adjusted, chain, streamKey]);

  const lastSlot = raw[String(slots.length - 1)];
  const loadMore = useCallback(() => {
    if (!lastSlot || lastSlot instanceof Error || lastSlot.isDone) return;
    setState((prev) => {
      if (prev.key !== streamKey) return prev;
      if (prev.slots[prev.slots.length - 1]?.cursor === lastSlot.continueCursor) return prev;
      return { key: streamKey, slots: [...prev.slots, { cursor: lastSlot.continueCursor }], depth: prev.slots.length + 1 };
    });
  }, [lastSlot, streamKey]);

  if (!active) return { rows: [] as StaffHistoryRow[], status: "Exhausted" as const, loadMore };

  const rows: StaffHistoryRow[] = [];
  const seen = new Set<string>();
  let loading = false;
  let last: PaginationResult<StaffHistoryRow> | undefined;
  for (let i = 0; i < slots.length; i++) {
    const res = raw[String(i)];
    if (res === undefined) { loading = true; break; }
    if (res instanceof Error) {
      if (isStaleHistoryCursor(res) && (slots.length > 1 || slots[0].cursor !== null || slots[0].endCursor !== undefined)) {
        loading = true;
        break;
      }
      throw res;
    }
    if (res.pageStatus === "SplitRequired" && res.splitCursor) { loading = true; break; }
    last = res;
    for (const item of res.page) {
      const id = (item as { entryId?: string }).entryId;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      rows.push(item);
    }
    if (i + 1 < slots.length && (res.isDone || res.continueCursor !== slots[i + 1].cursor)) {
      loading = true;
      break;
    }
  }
  const status: CustomerPage<HistoryEntry>["status"] = loading
    ? (rows.length || slots.length > 1 ? "LoadingMore" : "LoadingFirstPage")
    : !last ? "LoadingFirstPage" : last.isDone ? "Exhausted" : slots.length < chain.depth ? "LoadingMore" : "CanLoadMore";
  return { rows, status, loadMore };
}

type Readers = typeof import("./commerce-readers");
let readers: Readers | null = null;
let loading: Promise<Readers> | null = null;

/**
 * The commerce view mappers, loaded by the first commerce screen that reads (History, a receipt's
 * attempt or return card) rather than with checkout. null until then; a failed load reaches the
 * screen's error boundary and is retried on the next mount.
 */
function useReaders(wanted = true): Readers | null {
  const [loaded, setLoaded] = useState(readers);
  useEffect(() => {
    if (!wanted || loaded) return;
    let live = true;
    loading ??= import("./commerce-readers").then((module) => (readers = module), (error: unknown) => { loading = null; throw error; });
    loading.then((module) => { if (live) setLoaded(module); }, (error: unknown) => { if (live) setLoaded(() => { throw error; }); });
    return () => { live = false; };
  }, [loaded, wanted]);
  return loaded;
}

/**
 * Pay desk (W2A·L3): the attempt commands, the direct-panel registration and the cutover's access
 * reader over Convex. While paymentsMode is "direct" only the registration is new; the attempt
 * flow appears once the owner switches to new payments and this till reloads.
 */
// Late-bound, so module mocks of convex/react without these still load the backend.
const transport: PayDeskTransport = {
  useConnectionState: () => useConvexConnectionState(),
  useMutation: (ref) => useMutation(ref),
  useQuery: ((ref, args) => useQuery(ref, args)) as PayDeskTransport["useQuery"],
};
const payDesk = payDeskCommerce(transport, cutoverAccess(transport));

// ─── Returns desk (W2B·L3) ───
// Return items over pos.commands.returnItems. Only commerce receipts open the sheet, so with every
// sale switch Off nothing here runs; the managers' return queue loads only once payments use attempts.
const returnsDesk: ReturnsDesk = {
  useReturn: (args) => useQuery(api.pos.commands.returnItems.get, args ? returnArgs(args) : SKIP),
  useLots: (args) => {
    const key = args ? JSON.stringify(args) : "";
    const lotRequests = useMemo((): RequestForQueries =>
      key ? { lots: { query: api.pos.commands.returnItems.lots, args: JSON.parse(key) as ReturnLotsLookup } } : {}, [key]);
    return useQueries(lotRequests).lots;
  },
  useRequestStatus: (requestId) => useQuery(api.pos.staffApprovals.myStatus, requestId ? { requestId } : SKIP),
  useActions: () => {
    const convex = useConvex();
    const authorize = useMutation(api.pos.commands.returnItems.authorize);
    const askManager = useMutation(api.pos.commands.returnItems.askManager);
    const decideApproval = useMutation(api.pos.commands.returnItems.decideApproval);
    const claim = useMutation(api.pos.commands.returnItems.claim);
    const arm = useMutation(api.pos.commands.returnItems.arm);
    const recordPayout = useMutation(api.pos.commands.returnItems.recordPayout);
    const retry = useMutation(api.pos.commands.returnItems.retry);
    const cancel = useMutation(api.pos.commands.returnItems.cancel);
    const release = useMutation(api.pos.commands.returnItems.release);
    return useMemo(() => ({
      preview: (args) => convex.query(api.pos.commands.returnItems.preview, args),
      authorize, askManager, decideApproval, claim, arm, recordPayout, retry, cancel, release,
    }), [convex, authorize, askManager, decideApproval, claim, arm, recordPayout, retry, cancel, release]);
  },
};

/**
 * Commerce readers that have a backend so far: History, the receipt's payment attempt and open return,
 * and a requester's own request, beside the pay desk. The rest stay Off (COMMERCE_OFF) until their wave
 * lands; every sale switch is Off, so nothing new can be sold.
 */
const convexCommerce: CommerceBackend = {
  ...payDesk,
  useHistory: (target, audience) => {
    const page = useChainedHistory(target, audience);
    const mappers = useReaders();
    const results = useMemo(
      () => (mappers ? page.rows.map((row) => mappers.historyEntry(row as Parameters<typeof mappers.historyEntry>[0])) : []),
      [mappers, page.rows],
    );
    if (!target || (audience === "guest" && target.targetType !== "voucher" && target.targetType !== "grant")) {
      return NOTHING_TO_LOAD as CustomerPage<HistoryEntry>;
    }
    if (!mappers) return { results, status: "LoadingFirstPage", loadMore: () => {} };
    return { results, status: page.status, loadMore: page.loadMore };
  },
  // The receipt's status cards read getOrder's own projection: the same subscription ReceiptView
  // already holds ({ orderId }), so they add no reads.
  usePaymentAttempt: (orderId, activeAttemptId) => {
    const onReceipt = activeAttemptId === undefined;
    const live = payDesk.usePaymentAttempt(onReceipt ? null : orderId, activeAttemptId);
    const view = useQuery(api.pos.orders.getOrder, onReceipt && orderId ? { orderId } : SKIP);
    const mappers = useReaders(onReceipt && orderId !== null);
    const settled = useMemo(() => (view === undefined || !mappers ? undefined : view ? mappers.receiptAttempt(view) : null), [mappers, view]);
    return onReceipt ? (orderId ? settled : null) : live;
  },
  useReturnable: (orderId) => {
    const view = useQuery(api.pos.orders.getOrder, orderId ? { orderId } : SKIP);
    const mappers = useReaders();
    return useMemo(() => (view === undefined || !mappers ? undefined : view ? mappers.receiptReturnable(view) : null), [mappers, view]);
  },
  useMyApproval: (requestId) => useQuery(api.pos.staffApprovals.myStatus, requestId ? { requestId } : SKIP),
};

/** The live checkout: Convex queries and mutations from convex/pos/ and convex/pos/customers.ts. */
export const convexCheckoutBackend: CheckoutBackend = {
  useRestoreCheck: (orderId) => useQuery(api.pos.orders.restoreCheck, { orderId }),
  useAppointmentFees: (appointmentId) => useQuery(api.pos.orders.appointmentFees, { appointmentId }),
  useCorrectionHistory: (orderId) => usePaginatedQuery(api.pos.orderHistoryPages.corrections, { orderId }, { initialNumItems: 20 }),
  useAuditHistory: (orderId) => usePaginatedQuery(api.pos.orderHistoryPages.audit, { orderId }, { initialNumItems: 20 }),
  useBookingRefundHistory: (orderId) => usePaginatedQuery(api.pos.orderHistoryPages.bookingRefunds, { orderId }, { initialNumItems: 20 }),
  useAppointmentRefundHistory: (orderId) => usePaginatedQuery(api.pos.orderHistoryPages.appointmentRefunds, { orderId }, { initialNumItems: 20 }),
  useOrderRefundHistory: (orderId) => usePaginatedQuery(api.pos.orderHistoryPages.orderRefunds, { orderId }, { initialNumItems: 20 }),
  useCatalog: () => {
    const items = useQuery(api.pos.catalog.stableCatalog, {});
    const frequent = useQuery(api.pos.catalog.recentCatalogRanking, {});
    return useMemo(() => items === undefined || frequent === undefined ? undefined : { ...items, frequent }, [items, frequent]);
  },
  useOrder: (orderId, view) => useQuery(api.pos.orders.getOrder, orderId ? { orderId, ...(view ? { view } : {}) } : SKIP),
  useOrderHistory: (orderId) => usePaginatedQuery(api.pos.orders.orderHistory, { orderId }, { initialNumItems: 20 }),
  useOpenOrders: () => usePaginatedQuery(api.pos.orders.listOpenOrders, {}, { initialNumItems: 20 }),
  useOrders: (filter) => usePaginatedQuery(api.pos.orders.listOrders, { filter }, { initialNumItems: 20 }),
  useCustomerSearch: (query) => {
    const text = query.trim();
    const results = useQuery(api.pos.customers.searchCustomers, text.length >= 2 ? { query: text } : SKIP);
    return text.length >= 2 ? results : [];
  },
  useCustomerPage: (query, archived) => {
    const skip = useStaffAccess().role === "cashier" && cashierCannotBrowse(query, archived);
    const page = usePaginatedQuery(api.pos.customers.browseCustomers, skip ? SKIP : { query: query.trim(), archived }, { initialNumItems: 20 });
    return skip ? (NOTHING_TO_LOAD as CustomerPage<(typeof page.results)[number]>) : page;
  },
  useCustomer: (customerId) => useQuery(api.pos.customers.getCustomer, { customerId }),
  useCustomerHistory: (customerId) => usePaginatedQuery(api.pos.customers.customerHistory, { customerId }, { initialNumItems: 20 }),
  useCustomerOrders: (customerId) => usePaginatedQuery(api.pos.customers.listCustomerOrders, { customerId }, { initialNumItems: 20 }),
  useAttachable: ({ orderId, query }) => {
    const text = query.trim();
    return useQuery(api.pos.sourceReads.listAttachable, orderId || text.length >= 2 ? { orderId: orderId ?? undefined, query: text || undefined } : SKIP);
  },
  useAttachLookupStatus: ({ orderId, query }) => useQuery(api.pos.sourceReads.attachLookupStatus, { orderId: orderId ?? undefined, query: query.trim() || undefined }),
  useLinkCandidates: ({ orderId, lineId, query }) => useQuery(api.pos.sourceReads.linkCandidates, { orderId, lineId, query: query.trim() || undefined }),
  useBusinessName: () => useQuery(api.settings.settings.publicProfile, {})?.businessName,
  useOrderApprovals: (orderId) => useQuery(api.pos.staffApprovals.forOrder, orderId ? { orderId } : SKIP),
  // One cursor-paged compact list; only the selected request's detail is read (no per-row order or detail reads).
  usePendingApprovals: () => usePaginatedQuery(api.pos.staffApprovals.pendingPage, useStaffAccess().capabilities.approve ? {} : SKIP, { initialNumItems: 20 }),
  useApprovalQueueStates: (rows) => {
    const ids = rows.map(row => row._id).join(",");
    const approvalRequests = useMemo(() => Object.fromEntries(
      (ids ? ids.split(",") : []).map(id => [id, { query: api.pos.staffApprovals.queueStatus, args: { requestId: id as ApprovalId } }]),
    ), [ids]);
    return useQueries(approvalRequests) as Record<string, ApprovalQueueStatus | Error | undefined>;
  },
  useExpiredApprovals: (open) => useQuery(api.pos.staffApprovals.recentExpired, open ? {} : SKIP),
  useApprovalDetail: (requestId) => useQuery(api.pos.staffApprovals.detail, requestId ? { requestId } : SKIP),
  useFindOrder: (orderNumber, receipt) => useQuery(api.pos.orders.findOrderByNumber, orderNumber === null ? SKIP : { orderNumber, receipt }),
  commerce: convexCommerce,
  returns: returnsDesk,
  useActions: () => {
    const noteCouponRefusal = useMutation(api.marketing.report.noteCouponRefusal);
    const discardOrder = useMutation(api.pos.commands.discardOrder.discardOrder);
    const restoreOrder = useMutation(api.pos.commands.restoreOrder.restoreOrder);
    const addAppointmentFee = useMutation(api.pos.commands.addAppointmentFee.addAppointmentFee);
    const openOrderFor = useMutation(api.pos.commands.openOrderForLink.openOrderForLink);
    const addItem = useMutation(api.pos.commands.addItem.addItem);
    const attach = useMutation(api.pos.commands.attach.attach);
    const updateLine = useMutation(api.pos.commands.updateLine.updateLine);
    const overrideLinePrice = useMutation(api.pos.commands.overrideLinePrice.overrideLinePrice);
    const removeLine = useMutation(api.pos.commands.removeLine.removeLine);
    const updateSourceLine = useMutation(api.pos.commands.updateSourceLine.updateSourceLine);
    const linkCustomer = useMutation(api.pos.commands.linkCustomer.linkCustomer);
    const unlinkCustomer = useMutation(api.pos.commands.unlinkCustomer.unlinkCustomer);
    const saveOrder = useMutation(api.pos.commands.saveOrder.saveOrder);
    const clearOrder = useMutation(api.pos.commands.clearOrder.clearOrder);
    const settleOrder = useMutation(api.pos.commands.settleOrder.settleOrder);
    const amendOrderPayment = useMutation(api.pos.commands.amendOrderPayment.amendOrderPayment);
    const voidUnreceivedOrder = useMutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder);
    const linkPaidLine = useMutation(api.pos.commands.linkPaidLine.linkPaidLine);
    const unlinkPaidLine = useMutation(api.pos.commands.unlinkPaidLine.unlinkPaidLine);
    const refundLine = useMutation(api.pos.commands.refundLine.refundLine);
    const resumeCustomerMerge = useMutation(api.pos.customers.resumeCustomerMerge);
    const voidOrder = useMutation(api.pos.commands.voidOrder.voidOrder);
    const applyOrderCoupon = useMutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon);
    const removeOrderCoupon = useMutation(api.pos.commands.removeOrderCoupon.removeOrderCoupon);
    const recheckOrderCoupon = useMutation(api.pos.commands.recheckOrderCoupon.recheckOrderCoupon);
    const createCustomer = useMutation(api.pos.customers.createCustomer);
    const updateCustomer = useMutation(api.pos.customers.updateCustomer);
    const setCustomerArchived = useMutation(api.pos.customers.setCustomerArchived);
    const mergeCustomers = useMutation(api.pos.customers.mergeCustomers);
    const createOrder = useMutation(api.pos.commands.createOrder.createOrder);
    const createApproval = useMutation(api.pos.staffApprovals.create);
    const approveApproval = useMutation(api.pos.staffApprovals.approve);
    const rejectApproval = useMutation(api.pos.staffApprovals.reject);
    const cancelApproval = useMutation(api.pos.staffApprovals.cancel);
    return useMemo(
      () => ({
        noteCouponRefusal, discardOrder, restoreOrder, addAppointmentFee: withSwapOwner(addAppointmentFee), openOrderFor, addItem: withSwapOwner(addItem), attach: withSwapOwner(attach), updateLine: withSwapOwner(updateLine), overrideLinePrice: withSwapOwner(overrideLinePrice), removeLine: withSwapOwner(removeLine), updateSourceLine: withSwapOwner(updateSourceLine),
        linkCustomer: withSwapOwner(linkCustomer), unlinkCustomer: withSwapOwner(unlinkCustomer), saveOrder: withSwapOwner(saveOrder), clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers,
        applyOrderCoupon: withSwapOwner(applyOrderCoupon), removeOrderCoupon: withSwapOwner(removeOrderCoupon), recheckOrderCoupon: withSwapOwner(recheckOrderCoupon), linkPaidLine, unlinkPaidLine, refundLine,
        createOrder, createApproval, approveApproval, rejectApproval, cancelApproval,
      }),
      [createOrder, createApproval, approveApproval, rejectApproval, cancelApproval, noteCouponRefusal, applyOrderCoupon, removeOrderCoupon, recheckOrderCoupon, discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine, linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers, linkPaidLine, unlinkPaidLine, refundLine],
    );
  },
};
