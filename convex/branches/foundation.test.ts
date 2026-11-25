// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { PRIMARY_BRANCH, requireBranchAccess } from './model';
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
  await expect(owner.query(api.pos.catalog.stableCatalog, {})).rejects.toThrow('Not authorized');
  await expect(owner.query(api.marketing.report.getReport, {
    from: '2026-11-01', to: '2026-11-02', basis: 'cash',
  })).rejects.toThrow('Not authorized');
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
  await owner.mutation(staffApi.setGrant, { email: managerEmail, role: 'manager', branchIds: [samui, phuket] });
  await owner.mutation(staffApi.setGrant, { email: cashierEmail, role: 'cashier', branchIds: [phuket] });
  expect(await manager.query(staffApi.myAccess, {})).toMatchObject({
    role: null, branches: [], pendingInvitation: { role: 'manager', branchIds: [samui, phuket], expiresAt: expect.any(Number) },
  });
  await manager.mutation(staffApi.claimInvite, {});
  await cashier.mutation(staffApi.claimInvite, {});
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({
    companyScope: true, branches: [
      { id: samui, key: 'koh-samui', slug: 'koh-samui', name: 'Koh Samui', state: 'active' },
      { id: phuket, key: 'phuket', slug: 'phuket', name: 'Phuket', state: 'setup' },
    ],
  });
  expect(await manager.query(staffApi.myAccess, {})).toMatchObject({ role: 'manager', companyScope: false, branches: [{ id: samui }, { id: phuket }] });
  expect(await cashier.query(staffApi.myAccess, {})).toMatchObject({ role: 'cashier', companyScope: false, branches: [{ id: phuket }] });
  await t.run(async ctx => {
    const access = await accessForIdentity(ctx, cashierIdentity);
    expect(access.branchIds).toEqual([phuket]);
    await expect(requireBranchAccess(ctx, access, phuket)).resolves.toMatchObject({ _id: phuket });
    await expect(requireBranchAccess(ctx, access, samui)).rejects.toMatchObject(forbidden);
  });

  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 1, state: 'archived' })).resolves.toEqual({ revision: 2 });
  const archivedAccess = await cashier.query(staffApi.myAccess, {});
  expect(archivedAccess).toMatchObject({ companyScope: false, role: null, branches: [] });
  expect(Object.values(archivedAccess.capabilities).every(value => value === false)).toBe(true);
  expect(await manager.query(staffApi.myAccess, {})).toMatchObject({ role: 'manager', branches: [{ id: samui }] });
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({ branches: [{ id: samui }] });
  await t.run(async ctx => {
    expect(await accessForIdentity(ctx, managerIdentity)).toMatchObject({ branchIds: [samui] });
    const ownerAccess = await accessForIdentity(ctx, identity(ownerEmail));
    expect(ownerAccess).toMatchObject({ branchIds: [], companyScope: true });
    await expect(requireBranchAccess(ctx, ownerAccess, phuket)).rejects.toMatchObject(forbidden);
    await ctx.db.delete(samui);
    await expect(requireBranchAccess(ctx, ownerAccess, samui)).rejects.toMatchObject(forbidden);
  });
  expect(await manager.query(staffApi.myAccess, {})).toMatchObject({ role: null, branches: [] });
});

it('validates desk scope, preserves invite expiry and keeps owner grants out of Team mutations', async () => {
  const { t, owner, samui, phuket } = await setup();
  const email = 'invite@example.com';
  const invite = { email, role: 'manager' as const };
  await expect(owner.mutation(staffApi.setGrant, { ...invite, branchIds: [] })).rejects.toThrow('Select at least one branch.');
  await expect(owner.mutation(staffApi.setGrant, { ...invite, branchIds: [samui, samui] })).rejects.toThrow('Select each branch only once.');
  await owner.mutation(staffApi.setGrant, { ...invite, branchIds: [phuket] });
  await owner.mutation(branchApi.setState, { branchId: phuket, revision: 1, state: 'archived' });
  const invitee = t.withIdentity(identity(email));
  expect(await invitee.query(staffApi.myAccess, {})).toMatchObject({ role: null, pendingInvitation: null });
  await expect(invitee.mutation(staffApi.claimInvite, {})).rejects.toThrow('This invitation has no available branches. Ask an owner to update it.');
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
  const ownerGrantId = await t.mutation(ownerApi.grantOwner, { email: ownerEmail });
  for (const action of ['resend', 'expire'] as const) {
    await expect(owner.mutation(staffApi.updateInvitation, { grantId: ownerGrantId, action })).rejects.toThrow('Owners are managed by the deployment admin');
  }
  for (const role of ['manager', null] as const) {
    await expect(owner.mutation(api.marketing.access.setGrant, { email: ownerEmail, role })).rejects.toThrow('Owners are managed by the deployment admin');
  }
  await expect(owner.mutation(staffApi.setGrant, { email, role: null, branchIds: [] })).resolves.toBeNull();
  expect(await t.withIdentity(identity(email)).query(staffApi.myAccess, {})).toMatchObject({ role: null, pendingInvitation: null });
});

it('lists, upgrades and safely revokes CLI owners', async () => {
  const { t, owner, samui } = await setup();
  await expect(t.mutation(ownerApi.revokeOwner, { email: ownerEmail })).rejects.toThrow('Cannot revoke the last owner.');
  const email = 'recovery@example.com';
  const id = await owner.mutation(staffApi.setGrant, { email, role: 'manager', branchIds: [samui] });
  await expect(t.mutation(ownerApi.revokeOwner, { email })).resolves.toBeNull();
  expect(await t.run(ctx => ctx.db.get(id!))).toMatchObject({ role: 'manager' });
  await expect(t.mutation(ownerApi.grantOwner, { email })).resolves.toBe(id);
  await expect(t.mutation(ownerApi.grantOwner, { email })).resolves.toBe(id);
  expect(await t.query(ownerApi.listOwners, {})).toEqual([{ email: ownerEmail, claimed: true }, { email, claimed: false }]);
  await expect(t.mutation(ownerApi.revokeOwner, { email: ownerEmail })).rejects.toThrow('Cannot revoke the last owner.');
  await t.withIdentity(identity(email)).mutation(staffApi.claimInvite, {});
  await t.mutation(ownerApi.revokeOwner, { email: ownerEmail });
  expect(await owner.query(staffApi.myAccess, {})).toMatchObject({ role: null, companyScope: false });
  await expect(t.mutation(ownerApi.revokeOwner, { email })).rejects.toThrow('Cannot revoke the last owner.');
});

it('can revoke an unclaimed owner when there are no claimed owners', async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(ownerApi.grantOwner, { email: ownerEmail });
  await expect(t.mutation(ownerApi.revokeOwner, { email: ownerEmail })).resolves.toBeNull();
  expect(await t.run(ctx => ctx.db.get(id))).toBeNull();
});

it('enforces owner-only branch operations, unique identity, revision and audited lifecycle transitions', async () => {
  const { t, owner, samui, phuket } = await setup();
  const managerEmail = 'manager@example.com';
  const cashierEmail = 'cashier@example.com';
  await owner.mutation(staffApi.setGrant, { email: managerEmail, role: 'manager', branchIds: [samui] });
  await owner.mutation(staffApi.setGrant, { email: cashierEmail, role: 'cashier', branchIds: [samui] });
  const manager = t.withIdentity(identity(managerEmail));
  const cashier = t.withIdentity(identity(cashierEmail));
  for (const client of [manager, cashier]) await client.mutation(staffApi.claimInvite, {});
  for (const [client, message] of [[manager, 'Not authorized'], [cashier, 'Not authorized'], [t, 'Not authenticated']] as const) {
    await expect(client.query(branchApi.list, {})).rejects.toThrow(message);
    await expect(client.mutation(branchApi.create, { key: 'extra', ...profile })).rejects.toThrow(message);
    await expect(client.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile })).rejects.toThrow(message);
    await expect(client.mutation(branchApi.setState, { branchId: phuket, revision: 1, state: 'active' })).rejects.toThrow(message);
  }
  await expect(manager.query(api.settings.recordHistory.list, {
    entityType: 'branch', entityId: phuket, paginationOpts: { cursor: null, numItems: 20 },
  })).rejects.toThrow('Not authorized');
  await expect(owner.mutation(branchApi.create, { key: 'phuket', ...profile, slug: 'elsewhere' })).rejects.toThrow('This branch key is already in use.');
  await expect(owner.mutation(branchApi.create, { key: 'other', ...profile })).rejects.toThrow('This branch slug is already in use.');
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile, slug: 'koh-samui' })).rejects.toThrow('This branch slug is already in use.');
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile, issuer: { ...issuer, branchCode: '12' } })).rejects.toThrow('Enter a five-digit issuer branch code.');
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile, slug: 'phuket-town' })).resolves.toEqual({ revision: 2 });
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 1, ...profile })).rejects.toThrow('This branch changed.');
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 1, state: 'active' })).rejects.toThrow('This branch changed. Reload it and try again.');
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 2, state: 'suspended', reason: 'Test' })).rejects.toThrow('This branch state transition is not allowed.');
  await owner.mutation(branchApi.setState, { branchId: phuket, revision: 2, state: 'active' });
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 3, state: 'archived' })).rejects.toThrow('Suspend the branch before archiving it.');
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 3, state: 'suspended', reason: ' ' })).rejects.toThrow('Enter a reason for suspending this branch.');
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 3, state: 'suspended', reason: 'r'.repeat(501) })).rejects.toThrow('Enter a reason of at most 500 characters.');
  await owner.mutation(branchApi.setState, { branchId: phuket, revision: 3, state: 'suspended', reason: '  Repairs  ' });
  await owner.mutation(branchApi.setState, { branchId: phuket, revision: 4, state: 'active' });
  await owner.mutation(branchApi.setState, { branchId: phuket, revision: 5, state: 'suspended', reason: 'Closure' });
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 6, state: 'archived' })).resolves.toEqual({ revision: 7 });
  await expect(owner.mutation(branchApi.setState, { branchId: phuket, revision: 7, state: 'active' })).rejects.toThrow('This branch state transition is not allowed.');
  await expect(owner.mutation(branchApi.update, { branchId: phuket, revision: 7, ...profile })).rejects.toThrow('Archived branches are read-only.');
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

it('validates branch key, slug and required profile fields', async () => {
  const { owner, phuket } = await setup();
  await expect(owner.mutation(branchApi.create, { ...profile, key: 'new_branch' })).rejects.toThrow('Enter a branch key of 1–80 characters');
  await expect(owner.mutation(branchApi.update, { ...profile, branchId: phuket, revision: 1, slug: 'phuket--town' })).rejects.toThrow('Enter a branch slug of 1–80 characters');
  await expect(owner.mutation(branchApi.create, { ...profile, key: 'other', slug: ' ' })).rejects.toThrow('Enter a branch slug of 1–80 characters');
  await expect(owner.mutation(branchApi.create, { ...profile, key: 'other', issuer: { ...issuer, branchCode: ' ' } })).rejects.toThrow('Enter a five-digit issuer branch code.');
  await expect(owner.mutation(branchApi.create, { ...profile, key: 'other', name: ' ' })).rejects.toThrow('Enter a branch name.');
  await expect(owner.mutation(branchApi.create, { ...profile, key: 'other', name: 'a'.repeat(121) })).rejects.toThrow('Enter a branch name of at most 120 characters.');
  const fields = { legalName: 120, taxId: 32, address: 500 };
  for (const [field, maxLength] of Object.entries(fields)) {
    const args = { ...profile, branchId: phuket, revision: 1 };
    await expect(owner.mutation(branchApi.update, { ...args, issuer: { ...issuer, [field]: ' ' } })).rejects.toThrow('Enter the issuer legal name, tax ID and address.');
    await expect(owner.mutation(branchApi.update, { ...args, issuer: { ...issuer, [field]: 'a'.repeat(maxLength + 1) } })).rejects.toThrow(`at most ${maxLength} characters.`);
  }
});

it('rejects branch and owner lists over 500 rows', async () => {
  const { t, owner } = await setup();
  const now = Date.now();
  await t.run(async ctx => {
    for (let index = 0; index < 499; index++) {
      const key = `branch-${index}`;
      await ctx.db.insert('branches', {
        ...PRIMARY_BRANCH, key, slug: key, state: index % 2 ? 'suspended' : 'active',
        revision: 1, stateChangedAt: now, stateChangedByEmail: ownerEmail, createdAt: now, updatedAt: now,
      });
    }
    for (let index = 0; index < 500; index++) {
      await ctx.db.insert('staffGrants', {
        email: `imported-${index}@example.com`, role: 'owner', branchIds: [], createdAt: now, updatedAt: now, updatedByEmail: ownerEmail,
      });
    }
  });
  await expect(owner.query(branchApi.list, {})).rejects.toThrow('There are more than 500 branches to list.');
  await expect(owner.query(staffApi.myAccess, {})).rejects.toThrow('There are more than 500 branches to list.');
  await expect(t.query(ownerApi.listOwners, {})).rejects.toThrow('There are more than 500 owner grants.');
});

it('seeds both branches with issuer data and no grants by default', async () => {
  const t = convexTest(schema, modules);
  const args = { scenario: 'two-branch' as const };
  const result = await t.mutation(internal.maintenance.seed.seedAll, args);
  expect(result).toMatchObject({ scenario: 'two-branch', counts: { branches: 2, staffGrants: 0, properties: 3 } });
  await t.run(async ctx => {
    const [samui, phuket] = await ctx.db.query('branches').collect();
    expect(samui).toMatchObject({ key: 'koh-samui', state: 'active', issuer: { ...issuer, branchCode: '00000', address: '88/8 Moo 3, Bophut, Koh Samui, Surat Thani 84320' } });
    expect(phuket).toMatchObject({ key: 'phuket', state: 'setup', issuer: { ...issuer, address: '21 Moo 5, Kamala, Kathu, Phuket 83150' } });
  });
  await expect(t.mutation(internal.maintenance.seed.seedAll, args)).rejects.toThrow('Seed requires an empty database');
});

it('opts into exactly three unclaimed desk invites in the two-branch demo', async () => {
  const t = convexTest(schema, modules);
  const result = await t.mutation(internal.maintenance.seed.seedAll, { scenario: 'two-branch', demoAccess: true });
  expect(result.counts.staffGrants).toBe(3);
  await t.run(async ctx => {
    const [samui, phuket] = await ctx.db.query('branches').take(2);
    const grants = await ctx.db.query('staffGrants').take(4);
    expect(grants).toMatchObject([
      { email: 'niran@example.com', role: 'manager', branchIds: [samui._id, phuket._id] },
      { email: 'ploy@example.com', role: 'cashier', branchIds: [samui._id] },
      { email: 'kanya@example.com', role: 'manager', branchIds: [phuket._id] },
    ]);
    for (const grant of grants) {
      expect(grant.tokenIdentifier).toBeUndefined();
      expect(grant.inviteExpiresAt).toBeGreaterThan(grant.createdAt);
    }
  });
});
