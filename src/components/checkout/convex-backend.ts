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
  useOrder: (orderId) => useQuery(api.pos.orders.getOrder, orderId ? { orderId } : SKIP),
  useOrderHistory: (orderId) => usePaginatedQuery(api.pos.orders.orderHistory, { orderId }, { initialNumItems: 20 }),
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
  usePendingApprovals: () => useQuery(api.pos.staffApprovals.pending, useStaffAccess().capabilities.approve ? {} : SKIP),
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
        noteCouponRefusal, discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine,
        linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers,
        applyOrderCoupon, removeOrderCoupon, recheckOrderCoupon, linkPaidLine, unlinkPaidLine, refundLine,
        createOrder, createApproval, approveApproval, rejectApproval, cancelApproval,
      }),
      [createOrder, createApproval, approveApproval, rejectApproval, cancelApproval, noteCouponRefusal, applyOrderCoupon, removeOrderCoupon, recheckOrderCoupon, discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine, linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers, linkPaidLine, unlinkPaidLine, refundLine],
    );
  },
};
