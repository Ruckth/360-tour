"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import type { CheckoutBackend } from "./backend";

const SKIP = "skip" as const;

/** The live checkout: Convex queries and mutations from convex/pos.ts and convex/customers.ts. */
export const convexCheckoutBackend: CheckoutBackend = {
  useCatalog: () => useQuery(api.pos.catalog, {}),
  useOrder: (orderId) => useQuery(api.pos.getOrder, orderId ? { orderId } : SKIP),
  useOrders: (filter) => usePaginatedQuery(api.pos.listOrders, { filter }, { initialNumItems: 20 }),
  useCustomerSearch: (query) => {
    const text = query.trim();
    const results = useQuery(api.customers.searchCustomers, text.length >= 2 ? { query: text } : SKIP);
    return text.length >= 2 ? results : [];
  },
  useAttachable: ({ orderId, query }) => {
    const text = query.trim();
    return useQuery(api.pos.listAttachable, orderId || text.length >= 2 ? { orderId: orderId ?? undefined, query: text || undefined } : SKIP);
  },
  useAttachLookupStatus: () => useQuery(api.pos.attachLookupStatus, {}),
  useBusinessName: () => useQuery(api.settings.publicProfile, {})?.businessName,
  useActions: () => {
    const openOrderFor = useMutation(api.pos.openOrderFor);
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
    const voidOrder = useMutation(api.pos.voidOrder);
    const createCustomer = useMutation(api.customers.createCustomer);
    return useMemo(
      () => ({
        openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine,
        linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, voidOrder, createCustomer,
      }),
      [openOrderFor, addItem, attach, updateLine, overrideLinePrice, removeLine, updateSourceLine, linkCustomer, unlinkCustomer, saveOrder, clearOrder, settleOrder, voidOrder, createCustomer],
    );
  },
};
