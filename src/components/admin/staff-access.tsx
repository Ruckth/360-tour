"use client";

import { DEFAULT_CASHIER_RULES } from "convex/shared/staffTypes";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ADMIN_NAV } from "./admin-routes";
import { adminNavFor, type StaffAccessView } from "./admin-access";

/**
 * The signed-in person's auth/staffAccess.myAccess, loaded once by the admin shell. Without a provider
 * (isolated fixtures and older tests) it reads as an owner, which is the admin as it was before
 * staff roles. The server checks every call either way; this only shapes the UI.
 */
const OWNER_VIEW: StaffAccessView = {
  email: null,
  role: "owner",
  pendingInvitation: null,
  marketingRole: null,
  cashierRules: DEFAULT_CASHIER_RULES,
  capabilities: {
    checkout: true, approve: true, operations: true, manageTeam: true, settings: true, bookings: true, services: true,
    customers: true, orders: true, chats: true, properties: true, roster: true, reports: true, marketing: true,
  },
};

type StaffContext = { access: StaffAccessView; pendingApprovals: number };
const Context = createContext<StaffContext | undefined>(undefined);

export function StaffAccessProvider({ access, pendingApprovals = 0, children }: { access: StaffAccessView; pendingApprovals?: number; children?: ReactNode }) {
  const value = useMemo(() => ({ access, pendingApprovals }), [access, pendingApprovals]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStaffAccess(): StaffAccessView {
  return useContext(Context)?.access ?? OWNER_VIEW;
}

/** Effective approval requests waiting for this manager or owner (0 for everyone else). */
export function usePendingApprovalCount(): number {
  return useContext(Context)?.pendingApprovals ?? 0;
}

/** The sidebar sections this person can open. */
export function useAdminNav() {
  const access = useStaffAccess();
  return useMemo(() => adminNavFor(access, ADMIN_NAV), [access]);
}

/** A role's name as staff read it. */
export const ROLE_LABELS = { owner: "Owner", manager: "Manager", cashier: "Cashier" } as const;
