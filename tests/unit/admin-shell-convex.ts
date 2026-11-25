// convex/react for tests that render the real admin shell: staff access, the approvals queue and
// the business profile, with inert mutations and pages. Use from a vi.mock factory.
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from 'convex/_generated/dataModel';
import { DEFAULT_CASHIER_RULES } from 'convex/shared/staffTypes';

export type ShellRole = 'owner' | 'manager' | 'cashier' | null;

type ShellBranch = { id: Id<'branches'>; key: string; name: string; slug: string; state: 'setup' | 'active' | 'suspended' | 'archived' };
export const KOH_SAMUI: ShellBranch = { id: 'branch_samui' as Id<'branches'>, key: 'koh-samui', name: 'Koh Samui', slug: 'koh-samui', state: 'active' };
export const PHUKET: ShellBranch = { id: 'branch_phuket' as Id<'branches'>, key: 'phuket', name: 'Phuket', slug: 'phuket', state: 'setup' };

/** myAccess for a role. Desk roles always hold a branch (Koh Samui unless given); owners are company scope. */
export function staffAccessFor(role: ShellRole, email = 'staff@example.com', branches: ShellBranch[] = role === 'manager' || role === 'cashier' ? [KOH_SAMUI] : []) {
  const operations = role === 'owner' || role === 'manager';
  return {
    email, role, pendingInvitation: null, companyScope: role === "owner", branches, marketingRole: null as null | 'admin', cashierRules: DEFAULT_CASHIER_RULES,
    capabilities: {
      checkout: role !== null, approve: operations, operations, manageTeam: role === 'owner', settings: role === 'owner',
      bookings: operations, services: operations, customers: operations, orders: operations, chats: operations,
      properties: operations, roster: operations, reports: operations, marketing: role === 'owner',
    },
  };
}

export function shellConvex(state: { role: ShellRole; pending?: number }) {
  return {
    useQuery: (ref: FunctionReference<'query'>, args: unknown) => {
      if (args === 'skip') return undefined;
      const name = getFunctionName(ref);
      if (name === 'auth/staffAccess:myAccess') return staffAccessFor(state.role);
      if (name === 'pos/staffApprovals:pending') return { count: state.pending ?? 0, list: [] };
      return { businessName: 'Audit resort' };
    },
    useMutation: () => async () => null,
    usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: () => undefined }),
  };
}
