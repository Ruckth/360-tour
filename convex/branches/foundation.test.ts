// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { requireBranchAccess } from './model';
import { accessForIdentity } from '../auth/model';
import schema from '../schema';
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';

const modules = import.meta.glob('/convex/**/*.ts');
const ownerEmail = 'owner@example.com';
const identity = (email: string) => ({ email, emailVerified: true, tokenIdentifier: `issuer|${email}` });
const staffApi = api.auth.staffAccess;
const branchApi = api.branches.branches;
const ownerApi = internal.auth.owners;
const issuer = { legalName: '360 Tour Co., Ltd.', taxId: '0000000000000', branchCode: '00001', address: 'Phuket' };
const profile = { name: 'Phuket', slug: 'phuket', issuer };
const forbidden = { data: { code: 'BRANCH_FORBIDDEN', message: "You don't have access to this branch." } };

afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, identity(ownerEmail));
  const samui = await t.run(ctx => seedTestBranch(ctx));
  const phuket = await owner.mutation(branchApi.create, { key: 'phuket', ...profile });
  return { t, owner, samui, phuket };
}

it('uses only grants for owners and binds a CLI owner to the first verified account without expiry', async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv('ADMIN_EMAILS', ownerEmail);
  const owner = t.withIdentity(identity(ownerEmail));
  const anonymous = await t.query(staffApi.myAccess, {});
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false, branches: [], pendingInvitation: null, capabilities: anonymous.capabilities,
  });
  expect(Object.values(anonymous.capabilities).every(value => value === false)).toBe(true);
  expect(await owner.query(api.marketing.access.current, {})).toMatchObject({ role: null });
  await expect(owner.query(branchApi.list, {})).rejects.toThrow('Not authorized');

  await t.mutation(ownerApi.grantOwner, { email: ownerEmail.toUpperCase() });
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({
    role: null, pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [] },
  });
  const unverified = t.withIdentity({ ...identity(ownerEmail), emailVerified: false });
  await expect(unverified.mutation(staffApi.claimInvite, {})).rejects.toThrow('Verify your email');
  await owner.mutation(staffApi.claimInvite, {});
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({
    role: 'owner', companyScope: true, pendingInvitation: null, capabilities: { marketing: true },
  });
  const otherAccount = t.withIdentity({ ...identity(ownerEmail), tokenIdentifier: 'other|owner' });
  expect(await otherAccount.query(staffApi.myAccess, {})).toMatchObject({ role: null, pendingInvitation: null });
});

it('returns current branches for each role and removes desk access when all assigned branches close', async () => {
  const { t, owner, samui, phuket } = await setup();
  const managerEmail = 'manager@example.com', cashierEmail = 'cashier@example.com';
  const managerIdentity = identity(managerEmail), cashierIdentity = identity(cashierEmail);
  const manager = t.withIdentity(managerIdentity), cashier = t.withIdentity(cashierIdentity);
  await owner.mutation(staffApi.setGrant, { email: managerEmail, role: 'manager', branchIds: [phuket] });
  await owner.mutation(staffApi.setGrant, { email: cashierEmail, role: 'cashier', branchIds: [samui, phuket] });
  expect(await manager.query(staffApi.myAccess, {})).toMatchObject({
    role: null, branches: [], pendingInvitation: { role: 'manager', branchIds: [phuket], expiresAt: expect.any(Number) },
  });
  await manager.mutation(staffApi.claimInvite, {});
  await cashier.mutation(staffApi.claimInvite, {});
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({
    companyScope: true, branches: [
      { id: samui, key: 'koh-samui', slug: 'koh-samui', name: 'Koh Samui', state: 'active' },
      { id: phuket, key: 'phuket', slug: 'phuket', name: 'Phuket', state: 'setup' },
    ],
  });
  expect(await manager.query(staffApi.myAccess, {})).toMatchObject({ role: 'manager', companyScope: false, branches: [{ id: phuket }] });
  expect(await cashier.query(staffApi.myAccess, {})).toMatchObject({ role: 'cashier', companyScope: false, branches: [{ id: samui }, { id: phuket }] });
  await t.run(async ctx => {
    const access = await accessForIdentity(ctx, managerIdentity);
    expect(access.branchIds).toEqual([phuket]);
    await expect(requireBranchAccess(ctx, access, phuket)).resolves.toMatchObject({ _id: phuket });
    await expect(requireBranchAccess(ctx, access, samui)).rejects.toMatchObject(forbidden);
  });

  await owner.mutation(branchApi.setState, { branchId: phuket, state: 'archived' });
  const archivedAccess = await manager.query(staffApi.myAccess, {});
  expect(archivedAccess).toMatchObject({ companyScope: false, role: null, branches: [] });
  expect(Object.values(archivedAccess.capabilities).every(value => value === false)).toBe(true);
  for (const client of [cashier, owner]) expect(await client.query(staffApi.myAccess, {})).toMatchObject({ branches: [{ id: samui }] });
  await t.run(async ctx => {
    await expect(requireBranchAccess(ctx, await accessForIdentity(ctx, identity(ownerEmail)), phuket)).rejects.toMatchObject(forbidden);
    await ctx.db.delete(samui);
  });
  expect(await cashier.query(staffApi.myAccess, {})).toMatchObject({ role: null, branches: [] });
});

it('validates desk scope, preserves invite expiry and keeps owner grants out of Team mutations', async () => {
  const { t, owner, samui, phuket } = await setup();
  const email = 'invite@example.com';
  const invite = { email, role: 'manager' as const };
  await expect(owner.mutation(staffApi.setGrant, { ...invite, branchIds: [] })).rejects.toThrow('Select at least one branch.');
  await expect(owner.mutation(staffApi.setGrant, { ...invite, branchIds: [samui, samui] })).rejects.toThrow('Select each branch only once.');
  await owner.mutation(branchApi.setState, { branchId: phuket, state: 'archived' });
  await expect(owner.mutation(staffApi.setGrant, { ...invite, branchIds: [phuket] })).rejects.toThrow('Select existing branches that are not archived.');
  await t.run(ctx => ctx.db.delete(phuket));
  await expect(owner.mutation(staffApi.setGrant, { ...invite, branchIds: [phuket] })).rejects.toThrow('Select existing branches that are not archived.');
  const id = await owner.mutation(staffApi.setGrant, { ...invite, branchIds: [samui] });
  const before = (await owner.query(staffApi.listPeople, {})).find(person => person.email === email);
  await expect(owner.mutation(staffApi.setGrant, { ...invite, role: 'cashier', branchIds: [samui] })).resolves.toBe(id);
  expect(await owner.query(staffApi.listPeople, {})).toMatchObject([
    { email, role: 'cashier', branchIds: [samui], staffGrant: { id, claimed: false, expiresAt: before?.staffGrant?.expiresAt } },
    { email: ownerEmail, role: 'owner', branchIds: [], staffGrant: { role: 'owner', claimed: true, expiresAt: null } },
  ]);
  for (const role of ['manager', null] as const) {
    await expect(owner.mutation(staffApi.setGrant, { email: ownerEmail, role, branchIds: [samui] })).rejects.toThrow('Owners are managed by the deployment admin');
  }
  await expect(owner.mutation(staffApi.setGrant, { email, role: null, branchIds: [] })).resolves.toBeNull();
  expect(await t.withIdentity(identity(email)).query(staffApi.myAccess, {})).toMatchObject({ role: null, pendingInvitation: null });
});

it('lists, upgrades and safely revokes CLI owners', async () => {
  const { t, owner, samui } = await setup();
  await expect(t.mutation(ownerApi.revokeOwner, { email: ownerEmail })).rejects.toThrow('Cannot revoke the last owner.');
  const email = 'recovery@example.com';
  const id = await owner.mutation(staffApi.setGrant, { email, role: 'manager', branchIds: [samui] });
  await expect(t.mutation(ownerApi.grantOwner, { email })).resolves.toBe(id);
  await expect(t.mutation(ownerApi.grantOwner, { email })).resolves.toBe(id);
  expect(await t.query(ownerApi.listOwners, {})).toEqual([{ email: ownerEmail, claimed: true }, { email, claimed: false }]);
  await t.mutation(ownerApi.revokeOwner, { email: ownerEmail });
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({ role: null, companyScope: false });
  await expect(t.mutation(ownerApi.revokeOwner, { email })).rejects.toThrow('Cannot revoke the last owner.');
});

it('enforces owner-only branch operations, unique identity, revision and audited lifecycle transitions', async () => {
  const { t, owner, samui, phuket } = await setup();
  const managerEmail = 'manager@example.com';
  await owner.mutation(staffApi.setGrant, { email: managerEmail, role: 'manager', branchIds: [samui] });
  const manager = t.withIdentity(identity(managerEmail));
  await manager.mutation(staffApi.claimInvite, {});
  await expect(manager.query(branchApi.list, {})).rejects.toThrow('Not authorized');
  await expect(manager.query(api.settings.recordHistory.list, {
    entityType: 'branch', entityId: phuket, paginationOpts: { cursor: null, numItems: 20 },
  })).rejects.toThrow('Not authorized');
  await expect(manager.mutation(branchApi.create, { key: 'extra', ...profile })).rejects.toThrow('Not authorized');
  await expect(manager.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile })).rejects.toThrow('Not authorized');
  await expect(manager.mutation(branchApi.setState, { branchId: phuket, state: 'active' })).rejects.toThrow('Not authorized');
  await expect(owner.mutation(branchApi.create, { key: 'phuket', ...profile, slug: 'elsewhere' })).rejects.toThrow('This branch key is already in use.');
  await expect(owner.mutation(branchApi.create, { key: 'other', ...profile })).rejects.toThrow('This branch slug is already in use.');
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile, issuer: { ...issuer, branchCode: '12' } })).rejects.toThrow('Enter a five-digit issuer branch code.');
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile, slug: 'phuket-town' })).resolves.toEqual({ revision: 2 });
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile })).rejects.toThrow('This branch changed.');
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, state: 'suspended', reason: 'Test' })).rejects.toThrow('This branch state transition is not allowed.');
  await owner.mutation(branchApi.setState, { branchId: phuket, state: 'active' });
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, state: 'archived' })).rejects.toThrow('Suspend the branch before archiving it.');
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, state: 'suspended', reason: ' ' })).rejects.toThrow('Enter a reason for suspending this branch.');
  await owner.mutation(branchApi.setState, { branchId: phuket, state: 'suspended', reason: '  Repairs  ' });
  await owner.mutation(branchApi.setState, { branchId: phuket, state: 'active' });
  await owner.mutation(branchApi.setState, { branchId: phuket, state: 'suspended', reason: 'Closure' });
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, state: 'archived' })).resolves.toEqual({ revision: 7 });
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, state: 'active' })).rejects.toThrow('This branch state transition is not allowed.');
  const branch = (await owner.query(branchApi.list, {})).find(row => row._id === phuket);
  expect(branch).toMatchObject({ key: 'phuket', slug: 'phuket-town', state: 'archived', stateChangedByEmail: ownerEmail, revision: 7 });
  expect(branch?.stateReason).toBeUndefined();
  const history = await t.run(ctx => ctx.db.query('recordChanges').collect());
  expect(history.filter(row => row.kind === 'state_changed')).toMatchObject([
    { before: { state: 'setup' }, after: { state: 'active' } },
    { reason: 'Repairs', before: { state: 'active' }, after: { state: 'suspended', stateReason: 'Repairs' } },
    { before: { state: 'suspended' }, after: { state: 'active' } },
    { reason: 'Closure', before: { state: 'active' }, after: { state: 'suspended' } },
    { before: { state: 'suspended' }, after: { state: 'archived' } },
  ]);
});

it('seeds both branches with issuer data and the expected unclaimed grants from an empty database', async () => {
  const t = convexTest(schema, modules);
  const args = { scenario: 'two-branch' as const };
  const result = await t.mutation(internal.maintenance.seed.seedAll, args);
  expect(result).toMatchObject({ scenario: 'two-branch', counts: { branches: 2, staffGrants: 5, properties: 3 } });
  await t.run(async ctx => {
    const [samui, phuket] = await ctx.db.query('branches').collect();
    expect(samui).toMatchObject({ key: 'koh-samui', state: 'active', issuer: { ...issuer, branchCode: '00000', address: '88/8 Moo 3, Bophut, Koh Samui, Surat Thani 84320' } });
    expect(phuket).toMatchObject({ key: 'phuket', state: 'setup', issuer: { ...issuer, address: '21 Moo 5, Kamala, Kathu, Phuket 83150' } });
    expect(await ctx.db.query('staffGrants').collect()).toMatchObject([
      { email: ownerEmail, role: 'owner', branchIds: [] },
      { email: 'recovery@example.com', role: 'owner', branchIds: [] },
      { email: 'niran@example.com', role: 'manager', branchIds: [samui._id, phuket._id] },
      { email: 'ploy@example.com', role: 'cashier', branchIds: [samui._id] },
      { email: 'kanya@example.com', role: 'manager', branchIds: [phuket._id] },
    ]);
  });
  const niran = t.withIdentity(identity('niran@example.com'));
  expect(await niran.query(staffApi.myAccess, {})).toMatchObject({ role: null, pendingInvitation: { role: 'manager', branchIds: expect.any(Array) } });
  await expect(t.mutation(internal.maintenance.seed.seedAll, args)).rejects.toThrow('Seed requires an empty database');
});
