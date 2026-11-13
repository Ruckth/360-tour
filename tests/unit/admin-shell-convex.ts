// convex/react for tests that render the real admin shell: staff access, the approvals queue and
// the business profile, with inert mutations and pages. Use from a vi.mock factory.
import { getFunctionName, type FunctionReference } from 'convex/server';
import { DEFAULT_CASHIER_RULES } from 'convex/lib/staffTypes';

export type ShellRole = 'owner' | 'manager' | 'cashier' | null;

export function staffAccessFor(role: ShellRole, email = 'staff@example.com') {
  const operations = role === 'owner' || role === 'manager';
  return {
    email, role, pendingInvitation: null, marketingRole: null, cashierRules: DEFAULT_CASHIER_RULES,
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
