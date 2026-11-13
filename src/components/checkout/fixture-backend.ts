"use client";

import { useState } from "react";
import type { CheckoutActions, CheckoutBackend, CustomerPage } from "./backend";
import empty from "./design/empty.json";
import spa from "./design/spa.json";
import couponApplied from "./design/coupon-applied.json";
import couponPaid from "./design/coupon-paid.json";
import unscheduled from "./design/unscheduled.json";
import unscheduledPaid from "./design/unscheduled-paid.json";
import fee from "./design/fee.json";
import long from "./design/long.json";

const states = {
  empty,
  spa,
  "coupon-applied": couponApplied,
  "coupon-paid": couponPaid,
  unscheduled,
  "unscheduled-paid": unscheduledPaid,
  fee,
  long,
};
export type CheckoutDesignState = keyof typeof states;
type View = {
  catalog: ReturnType<CheckoutBackend["useCatalog"]>;
  view: ReturnType<CheckoutBackend["useOrder"]>;
  orders: ReturnType<CheckoutBackend["useOrders"]>["results"];
  attachable: ReturnType<CheckoutBackend["useAttachable"]>;
  businessName: string;
};
export const checkoutDesignStates = (Object.keys(states) as CheckoutDesignState[]).map((key) => ({
  key,
  orderId: (states[key] as unknown as View).view?.order._id ?? null,
}));
function usePage<T>(rows: T[]): CustomerPage<T> {
  const [count, setCount] = useState(20);
  return {
    results: rows.slice(0, count),
    status: rows.length > count ? "CanLoadMore" : "Exhausted",
    loadMore: (n) => setCount(count + n),
  };
}
const noWrite = async () => {
  throw new Error(
    "Choose a canned design state, or use the signed-in local checkout to change an order.",
  );
};
/** Canned presentation only. No database, money calculations, business transitions or authorization. */
export function createFixtureBackend(
  state: CheckoutDesignState = "empty",
): CheckoutBackend {
  const snapshot = states[state] as unknown as View;
  const actions: CheckoutActions = {
    noteCouponRefusal: noWrite,
    discardOrder: noWrite,
    restoreOrder: noWrite,
    addAppointmentFee: noWrite,
    openOrderFor: noWrite,
    addItem: noWrite,
    attach: noWrite,
    updateLine: noWrite,
    overrideLinePrice: noWrite,
    removeLine: noWrite,
    updateSourceLine: noWrite,
    linkCustomer: noWrite,
    unlinkCustomer: noWrite,
    saveOrder: noWrite,
    clearOrder: noWrite,
    settleOrder: noWrite,
    amendOrderPayment: noWrite,
    voidUnreceivedOrder: noWrite,
    linkPaidLine: noWrite,
    unlinkPaidLine: noWrite,
    refundLine: noWrite,
    applyOrderCoupon: noWrite,
    removeOrderCoupon: noWrite,
    recheckOrderCoupon: noWrite,
    createCustomer: noWrite,
    updateCustomer: noWrite,
    setCustomerArchived: noWrite,
    mergeCustomers: noWrite,
    resumeCustomerMerge: noWrite,
    voidOrder: noWrite,
    createOrder: noWrite,
    createApproval: noWrite,
    approveApproval: noWrite,
    rejectApproval: noWrite,
    cancelApproval: noWrite,
  };
  return {
    useActions: () => actions,
    useCatalog: () => snapshot.catalog,
    useOrder: (id) => (id ? snapshot.view : null),
    useOrders: () => usePage(snapshot.orders),
    useOrderHistory: () => usePage([]),
    useCorrectionHistory: () => usePage(snapshot.view?.corrections ?? []),
    useAuditHistory: () => usePage(snapshot.view?.audit ?? []),
    useBookingRefundHistory: () => usePage([]),
    useAppointmentRefundHistory: () => usePage([]),
    useOrderRefundHistory: () => usePage([]),
    useAppointmentFees: () => [],
    useRestoreCheck: () => undefined,
    useCustomerSearch: () => [],
    useCustomerPage: () => usePage([]),
    useCustomer: () => null,
    useCustomerHistory: () => usePage([]),
    useCustomerOrders: () => usePage([]),
    useAttachable: () => snapshot.attachable,
    useAttachLookupStatus: () => ({ complete: true }),
    useLinkCandidates: () => [],
    useBusinessName: () => snapshot.businessName,
    useOrderApprovals: () => [],
    usePendingApprovals: () => ({ count: 0, list: [] }),
    useFindOrder: () => null,
  };
}
