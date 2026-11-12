"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import type { CheckoutBackend, CustomerPage } from "./backend";

const SKIP = "skip" as const;
const NOTHING_TO_LOAD = { results: [], status: "Exhausted" as const, loadMore: () => {} };
/** Cashiers may only search active customers by at least two characters (customers.browseCustomers). */
const cashierCannotBrowse = (query: string, archived: boolean) => archived || query.trim().length < 2;

/** The live checkout: Convex queries and mutations from convex/pos.ts and convex/customers.ts. */
export const convexCheckoutBackend: CheckoutBackend = {
  useRestoreCheck: (orderId) => useQuery(api.pos.restoreCheck, { orderId }),
  useAppointmentFees: (appointmentId) => useQuery(api.pos.appointmentFees, { appointmentId }),
  useCorrectionHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.corrections, { orderId }, { initialNumItems: 20 }),
  useAuditHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.audit, { orderId }, { initialNumItems: 20 }),
  useBookingRefundHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.bookingRefunds, { orderId }, { initialNumItems: 20 }),
  useAppointmentRefundHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.appointmentRefunds, { orderId }, { initialNumItems: 20 }),
  useBillRefundHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.billRefunds, { orderId }, { initialNumItems: 20 }),
  useCatalog: () => {
    const items = useQuery(api.pos.stableCatalog, {});
    const frequent = useQuery(api.pos.recentCatalogRanking, {});
    return useMemo(() => items === undefined || frequent === undefined ? undefined : { ...items, frequent }, [items, frequent]);
  },
  useOrder: (orderId) => useQuery(api.pos.getOrder, orderId ? { orderId } : SKIP),
  useOrderHistory: (orderId) => usePaginatedQuery(api.pos.orderHistory, { orderId }, { initialNumItems: 20 }),
  useOrders: (filter) => usePaginatedQuery(api.pos.listOrders, { filter }, { initialNumItems: 20 }),
  useCustomerSearch: (query) => {
    const text = query.trim();
    const results = useQuery(api.customers.searchCustomers, text.length >= 2 ? { query: text } : SKIP);
    return text.length >= 2 ? results : [];
  },
  useCustomerPage: (query, archived) => {
    const skip = useStaffAccess().role === "cashier" && cashierCannotBrowse(query, archived);
    const page = usePaginatedQuery(api.customers.browseCustomers, skip ? SKIP : { query: query.trim(), archived }, { initialNumItems: 20 });
    return skip ? (NOTHING_TO_LOAD as CustomerPage<(typeof page.results)[number]>) : page;
  },
  useCustomer: (customerId) => useQuery(api.customers.getCustomer, { customerId }),
  useCustomerHistory: (customerId) => usePaginatedQuery(api.customers.customerHistory, { customerId }, { initialNumItems: 20 }),
  useCustomerOrders: (customerId) => usePaginatedQuery(api.customers.listCustomerOrders, { customerId }, { initialNumItems: 20 }),
  useAttachable: ({ orderId, query }) => {
    const text = query.trim();
    return useQuery(api.pos.listAttachable, orderId || text.length >= 2 ? { orderId: orderId ?? undefined, query: text || undefined } : SKIP);
  },
  useAttachLookupStatus: ({ orderId, query }) => useQuery(api.pos.attachLookupStatus, { orderId: orderId ?? undefined, query: query.trim() || undefined }),
  useLinkCandidates: ({ orderId, lineId, query }) => useQuery(api.pos.linkCandidates, { orderId, lineId, query: query.trim() || undefined }),
  useBusinessName: () => useQuery(api.settings.publicProfile, {})?.businessName,
  useOrderApprovals: (orderId) => useQuery(api.staffApprovals.forOrder, orderId ? { orderId } : SKIP),
  usePendingApprovals: () => useQuery(api.staffApprovals.pending, useStaffAccess().capabilities.approve ? {} : SKIP),
  useFindOrder: (orderNumber) => useQuery(api.pos.findOrderByNumber, orderNumber === null ? SKIP : { orderNumber }),
  useActions: () => {
    const noteCouponRefusal = useMutation(api.marketingReport.noteCouponRefusal);
    const discardOrder = useMutation(api.pos.discardOrder);
    const restoreOrder = useMutation(api.pos.restoreOrder);
    const addAppointmentFee = useMutation(api.pos.addAppointmentFee);
    const openOrderFor = useMutation(api.pos.openOrderForLink);
    const addItem = useMutation(api.pos.addItem);
    const attach = useMutation(api.pos.attach);
    const updateLine = useMutation(api.pos.updateLine);
    const overrideLinePrice = useMutation(api.pos.overrideLinePrice);
    const removeLine = useMutation(api.pos.removeLine);
    const updateSourceLine = useMutation(api.pos.updateSourceLine);
    const linkCustomer = useMutation(api.pos.linkCustomer);
    const unlinkCustomer = useMutation(api.pos.unlinkCustomer);
    const saveOrder = useMutation(api.pos.saveOrder);
    const clearOrder = useMutation(api.pos.clearOrder);
    const settleOrder = useMutation(api.pos.settleOrder);
    const amendOrderPayment = useMutation(api.pos.amendOrderPayment);
    const voidUnreceivedOrder = useMutation(api.pos.voidUnreceivedOrder);
    const linkPaidLine = useMutation(api.pos.linkPaidLine);
    const unlinkPaidLine = useMutation(api.pos.unlinkPaidLine);
    const refundLine = useMutation(api.pos.refundLine);
    const resumeCustomerMerge = useMutation(api.customers.resumeCustomerMerge);
    const voidOrder = useMutation(api.pos.voidOrder);
    const applyOrderCoupon = useMutation(api.pos.applyOrderCoupon);
    const removeOrderCoupon = useMutation(api.pos.removeOrderCoupon);
    const recheckOrderCoupon = useMutation(api.pos.recheckOrderCoupon);
    const createCustomer = useMutation(api.customers.createCustomer);
    const updateCustomer = useMutation(api.customers.updateCustomer);
    const setCustomerArchived = useMutation(api.customers.setCustomerArchived);
    const mergeCustomers = useMutation(api.customers.mergeCustomers);
    const createOrder = useMutation(api.pos.createOrder);
    const createApproval = useMutation(api.staffApprovals.create);
    const approveApproval = useMutation(api.staffApprovals.approve);
    const rejectApproval = useMutation(api.staffApprovals.reject);
    const cancelApproval = useMutation(api.staffApprovals.cancel);
    return useMemo(
      () => ({
        noteCouponRefusal, discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine,
        linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers,
        applyOrderCoupon, removeOrderCoupon, recheckOrderCoupon, linkPaidLine, unlinkPaidLine, refundLine,
        createOrder, createApproval, approveApproval, rejectApproval, cancelApproval,
      }),
      [createOrder, createApproval, approveApproval, rejectApproval, cancelApproval, noteCouponRefusal, applyOrderCoupon, removeOrderCoupon, recheckOrderCoupon, discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine, linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers, linkPaidLine, unlinkPaidLine, refundLine],
    );
  },
};
