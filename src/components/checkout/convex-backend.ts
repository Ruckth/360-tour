"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import { guestsFromBookings, type CheckoutBackend } from "./backend";

/** The live checkout: Convex queries and mutations from convex/pos.ts. */
export const convexCheckoutBackend: CheckoutBackend = {
  useCatalog: () => useQuery(api.pos.catalog, {}),
  useBill: (billId) => useQuery(api.pos.getBill, billId ? { billId } : "skip"),
  useOpenBills: () => useQuery(api.pos.listOpenBills, {}),
  useNextWalkIn: () => useQuery(api.pos.nextWalkInNumber, {}),
  useGuestSearch: (query) => {
    const rows = useQuery(api.adminBookings.searchBookings, query.trim().length >= 2 ? { query } : "skip");
    return useMemo(() => rows && guestsFromBookings(rows), [rows]);
  },
  useAttachable: (guest) =>
    useQuery(api.pos.listAttachable, guest ? { guestName: guest.name, guestPhone: guest.phone, guestEmail: guest.email } : "skip"),
  useBusinessName: () => useQuery(api.settings.publicProfile, {})?.businessName,
  useActions: () => {
    const openFor = useMutation(api.pos.openFor);
    const addItem = useMutation(api.pos.addItem);
    const attach = useMutation(api.pos.attach);
    const updateLine = useMutation(api.pos.updateLine);
    const overrideLinePrice = useMutation(api.pos.overrideLinePrice);
    const removeLine = useMutation(api.pos.removeLine);
    const setCustomer = useMutation(api.pos.setCustomer);
    const holdBill = useMutation(api.pos.holdBill);
    const clearBill = useMutation(api.pos.clearBill);
    const settleBill = useMutation(api.pos.settleBill);
    const voidBill = useMutation(api.pos.voidBill);
    return useMemo(
      () => ({ openFor, addItem, attach, updateLine, overrideLinePrice, removeLine, setCustomer, holdBill, clearBill, settleBill, voidBill }),
      [openFor, addItem, attach, updateLine, overrideLinePrice, removeLine, setCustomer, holdBill, clearBill, settleBill, voidBill],
    );
  },
};
