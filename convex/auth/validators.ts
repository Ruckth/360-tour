import { v } from 'convex/values';
import { branchState } from '../shared/branchTypes';
import { marketingRole } from '../shared/affiliateTypes';
import { resolvedCashierRulesValidator, staffRole } from '../shared/staffTypes';

export const usersFields = {
  clerkId: v.string(),
  tokenIdentifier: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
};

export const grantRole = v.union(v.literal('owner'), staffRole);
const branchIds = v.array(v.id('branches'));
const invitedBranches = v.array(v.object({ id: v.id('branches'), name: v.string() }));
const expiry = v.union(v.null(), v.number());

export const staffAccessMyAccessResult = v.object({
  email: v.union(v.null(), v.string()),
  role: v.union(v.null(), grantRole),
  companyScope: v.boolean(),
  branches: v.array(v.object({ id: v.id('branches'), key: v.string(), name: v.string(), slug: v.string(), state: branchState })),
  pendingInvitation: v.union(
    v.null(),
    v.object({ role: v.literal('owner'), expiresAt: v.null(), branchIds, branches: invitedBranches }),
    v.object({ role: staffRole, expiresAt: v.number(), branchIds, branches: invitedBranches }),
  ),
  capabilities: v.object({
    marketing: v.boolean(),
    checkout: v.boolean(),
    approve: v.boolean(),
    operations: v.boolean(),
    manageTeam: v.boolean(),
    settings: v.boolean(),
    bookings: v.boolean(),
    services: v.boolean(),
    customers: v.boolean(),
    orders: v.boolean(),
    chats: v.boolean(),
    properties: v.boolean(),
    roster: v.boolean(),
    reports: v.boolean(),
  }),
  cashierRules: resolvedCashierRulesValidator,
  marketingInvitation: v.union(v.null(), v.object({ role: marketingRole, expiresAt: v.number() })),
  marketingRole: v.union(v.null(), v.literal('admin'), marketingRole),
});

const grantStatus = { claimed: v.boolean(), expiresAt: expiry, expired: v.boolean(), updatedAt: v.number() };
export const staffAccessListPeopleResult = v.array(v.object({
  email: v.string(),
  role: v.union(v.null(), grantRole),
  branchIds,
  staffGrant: v.union(v.null(), v.object({ id: v.id('staffGrants'), revision: v.number(), role: grantRole, ...grantStatus })),
  separateMarketingAccount: v.boolean(),
  marketingGrant: v.union(v.null(), v.object({ id: v.id('marketingGrants'), revision: v.number(), role: marketingRole, ...grantStatus })),
}));
