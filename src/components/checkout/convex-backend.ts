"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import type { CheckoutBackend } from "./backend";

const SKIP = "skip" as const;

/** The live checkout: Convex queries and mutations from convex/pos.ts and convex/customers.ts. */
export const convexCheckoutBackend: CheckoutBackend = {
  useRestoreCheck: (orderId) => useQuery(api.pos.restoreCheck, { orderId }),
  useAppointmentFees: (appointmentId) => useQuery(api.pos.appointmentFees, { appointmentId }),
  useCorrectionHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.corrections, { orderId }, { initialNumItems: 20 }),
  useAuditHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.audit, { orderId }, { initialNumItems: 20 }),
  useBookingRefundHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.bookingRefunds, { orderId }, { initialNumItems: 20 }),
  useAppointmentRefundHistory: (orderId) => usePaginatedQuery(api.orderHistoryPages.appointmentRefunds, { orderId }, { initialNumItems: 20 }),
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
  useCustomerPage: (query, archived) => usePaginatedQuery(api.customers.browseCustomers, { query: query.trim(), archived }, { initialNumItems: 20 }),
  useCustomer: (customerId) => useQuery(api.customers.getCustomer, { customerId }),
  useCustomerHistory: (customerId) => usePaginatedQuery(api.customers.customerHistory, { customerId }, { initialNumItems: 20 }),
  useCustomerOrders: (customerId) => usePaginatedQuery(api.customers.listCustomerOrders, { customerId }, { initialNumItems: 20 }),
  useAttachable: ({ orderId, query }) => {
    const text = query.trim();
    return useQuery(api.pos.listAttachable, orderId || text.length >= 2 ? { orderId: orderId ?? undefined, query: text || undefined } : SKIP);
  },
  useAttachLookupStatus: () => useQuery(api.pos.attachLookupStatus, {}),
  useBusinessName: () => useQuery(api.settings.publicProfile, {})?.businessName,
  useActions: () => {
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
    const resumeCustomerMerge = useMutation(api.customers.resumeCustomerMerge);
    const voidOrder = useMutation(api.pos.voidOrder);
    const createCustomer = useMutation(api.customers.createCustomer);
    const updateCustomer = useMutation(api.customers.updateCustomer);
    const setCustomerArchived = useMutation(api.customers.setCustomerArchived);
    const mergeCustomers = useMutation(api.customers.mergeCustomers);
    return useMemo(
      () => ({
        discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine,
        linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers,
      }),
      [discardOrder, restoreOrder, addAppointmentFee, openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine, linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, amendOrderPayment, voidUnreceivedOrder, resumeCustomerMerge, voidOrder, createCustomer, updateCustomer, setCustomerArchived, mergeCustomers],
    );
  },
};
