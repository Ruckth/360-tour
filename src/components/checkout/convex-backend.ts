"use client";

import { useConvexConnectionState, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useEffect, useMemo, useState } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import type { CheckoutBackend, CommerceBackend, CustomerPage, HistoryEntry } from "./backend";
import { cutoverAccess, payDeskCommerce, type PayDeskTransport, withSwapOwner } from "./pay-desk-backend";

const SKIP = "skip" as const;
const NOTHING_TO_LOAD = { results: [], status: "Exhausted" as const, loadMore: () => {} };
/** Cashiers may only search active customers by at least two characters (customers.browseCustomers). */
const cashierCannotBrowse = (query: string, archived: boolean) => archived || query.trim().length < 2;

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

/**
 * Commerce readers that have a backend so far: History, the receipt's payment attempt and open return,
 * and a requester's own request, beside the pay desk. The rest stay Off (COMMERCE_OFF) until their wave
 * lands; every sale switch is Off, so nothing new can be sold.
 */
const convexCommerce: CommerceBackend = {
  ...payDesk,
  useHistory: (target, audience) => {
    const benefit = target?.targetType === "voucher" || target?.targetType === "grant" ? target : null;
    const staff = usePaginatedQuery(api.commerce.history.staffPage, target && audience === "staff" ? { target } : SKIP, { initialNumItems: 20 });
    const guest = usePaginatedQuery(api.commerce.history.guestPage, benefit && audience === "guest" ? { target: benefit } : SKIP, { initialNumItems: 20 });
    const page = audience === "guest" ? guest : staff;
    const mappers = useReaders();
    const results = useMemo(() => (mappers ? page.results.map(mappers.historyEntry) : []), [mappers, page.results]);
    if (!target || (audience === "guest" && !benefit)) return NOTHING_TO_LOAD as CustomerPage<HistoryEntry>;
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
  commerce: convexCommerce,
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
  useApprovalDetail: (requestId) => useQuery(api.pos.staffApprovals.detail, requestId ? { requestId } : SKIP),
  useFindOrder: (orderNumber) => useQuery(api.pos.orders.findOrderByNumber, orderNumber === null ? SKIP : { orderNumber }),
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
