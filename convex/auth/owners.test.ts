// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { accessForIdentity } from './model';
import schema from '../schema';
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';

const modules = import.meta.glob('/convex/**/*.ts');
const identity = (email: string, tokenIdentifier = `issuer|${email}`, emailVerified = true) => ({
  email, emailVerified, tokenIdentifier,
});
const staffApi = api.auth.staffAccess;
const branchApi = api.branches.branches;
const ownerApi = internal.auth.owners;

afterEach(() => vi.unstubAllEnvs());

async function setupWithOwner() {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, identity('owner@example.com'));
  const samui = await t.run(ctx => seedTestBranch(ctx));
  return { t, owner, samui };
}

it('clears previous tokenIdentifier, invitation expiry and branchIds on desk-to-owner promotion and requires verified re-claim', async () => {
  const { t, owner, samui } = await setupWithOwner();
  const email = 'manager@example.com';
  const deskId = await owner.mutation(staffApi.setGrant, {
    email, role: 'manager', branchIds: [samui], expectedGrant: null,
  });
  expect(deskId).not.toBeNull();

  const deskIdentity = identity(email, 'issuer|desk-holder');
  const deskClient = t.withIdentity(deskIdentity);
  await deskClient.mutation(staffApi.claimInvite, {});
  expect(await deskClient.query(staffApi.myAccess, {})).toMatchObject({
    role: 'manager', companyScope: false, branches: [{ id: samui }], pendingInvitation: null,
  });

  // Even if the old holder had moved to another email, promoting the original desk email
  // must unbind the previous tokenIdentifier and never silently elevate them to owner.
  const movedOldHolder = t.withIdentity(identity('moved@example.com', 'issuer|desk-holder'));
  expect(await movedOldHolder.query(staffApi.myAccess, {})).toMatchObject({ role: 'manager', companyScope: false });

  // Also ensure any lingering inviteExpiresAt is cleared on promotion.
  await t.run(ctx => ctx.db.patch(deskId!, { inviteExpiresAt: Date.now() + 60_000 }));

  const promotedId = await t.mutation(ownerApi.grantOwner, { email });
  expect(promotedId).toBe(deskId);

  const promotedRow = await t.run(ctx => ctx.db.get(promotedId));
  expect(promotedRow).toMatchObject({ email, role: 'owner', branchIds: [] });
  expect(promotedRow?.tokenIdentifier).toBeUndefined();
  expect(promotedRow?.inviteExpiresAt).toBeUndefined();
  expect(await t.query(ownerApi.listOwners, {})).toEqual([
    { email: 'owner@example.com', claimed: true },
    { email, claimed: false },
  ]);

  // Previous holder at a different email loses access and cannot claim the owner grant.
  expect(await movedOldHolder.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false, branches: [], pendingInvitation: null,
  });
  await expect(movedOldHolder.mutation(staffApi.claimInvite, {})).rejects.toThrow('No unclaimed invitation');

  // Same account still holding the promoted email has no active role until verified re-claim.
  const unverified = t.withIdentity(identity(email, 'issuer|desk-holder', false));
  expect(await unverified.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false, pendingInvitation: null,
  });
  await expect(unverified.mutation(staffApi.claimInvite, {})).rejects.toThrow('Verify your email');

  expect(await deskClient.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false, branches: [],
    pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [], branches: [] },
  });
  await expect(deskClient.query(branchApi.list, {})).rejects.toThrow('Not authorized');

  await deskClient.mutation(staffApi.claimInvite, {});
  await deskClient.mutation(staffApi.claimInvite, {});
  expect(await deskClient.query(staffApi.myAccess, {})).toMatchObject({
    role: 'owner', companyScope: true, pendingInvitation: null,
    capabilities: { manageTeam: true, settings: true, marketing: true },
  });
  expect(await t.query(ownerApi.listOwners, {})).toEqual([
    { email: 'owner@example.com', claimed: true },
    { email, claimed: true },
  ]);

  const history = await t.run(ctx =>
    ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q =>
      q.eq('entityType', 'staffGrant').eq('entityId', promotedId),
    ).collect(),
  );
  expect(history.find(entry => entry.kind === 'updated')).toMatchObject({
    actor: 'system:deployment-admin',
    before: { email, role: 'manager', branchIds: [samui], claimed: true },
    after: { email, role: 'owner', branchIds: [], claimed: false },
  });
  expect(history.filter(entry => entry.kind === 'claimed')).toHaveLength(2);
});

it('keeps existing claimed owners idempotent unless explicit rebind:true is passed for recovery', async () => {
  const t = convexTest(schema, modules);
  const email = 'owner@example.com';
  const grantId = await t.mutation(ownerApi.grantOwner, { email });
  const original = t.withIdentity(identity(email, 'issuer|original-owner'));
  await original.mutation(staffApi.claimInvite, {});

  const claimedBefore = await t.run(ctx => ctx.db.get(grantId));
  const historyCountBefore = (await t.run(ctx => ctx.db.query('recordChanges').collect())).length;

  // Routine/accidental grantOwner calls leave a claimed owner intact.
  await expect(t.mutation(ownerApi.grantOwner, { email })).resolves.toBe(grantId);
  await expect(t.mutation(ownerApi.grantOwner, { email, rebind: false })).resolves.toBe(grantId);
  expect(await t.run(ctx => ctx.db.get(grantId))).toEqual(claimedBefore);
  expect((await t.run(ctx => ctx.db.query('recordChanges').collect())).length).toBe(historyCountBefore);
  expect(await original.query(staffApi.myAccess, {})).toMatchObject({ role: 'owner', companyScope: true });

  // Explicit recovery rebind clears tokenIdentifier even for the sole owner.
  await expect(t.mutation(ownerApi.grantOwner, { email, rebind: true })).resolves.toBe(grantId);
  const reboundRow = await t.run(ctx => ctx.db.get(grantId));
  expect(reboundRow?.tokenIdentifier).toBeUndefined();
  expect(reboundRow?.inviteExpiresAt).toBeUndefined();
  expect(reboundRow?.branchIds).toEqual([]);
  expect(reboundRow?.revision).toBe((claimedBefore?.revision ?? 0) + 1);

  const historyAfterRebind = await t.run(ctx => ctx.db.query('recordChanges').collect());
  expect(historyAfterRebind[historyAfterRebind.length - 1]).toMatchObject({
    entityType: 'staffGrant', entityId: grantId, actor: 'system:deployment-admin', kind: 'rebound',
    before: { email, role: 'owner', branchIds: [], claimed: true },
    after: { email, role: 'owner', branchIds: [], claimed: false },
  });

  // Repeating rebind while already unclaimed is idempotent.
  await expect(t.mutation(ownerApi.grantOwner, { email, rebind: true })).resolves.toBe(grantId);
  expect((await t.run(ctx => ctx.db.query('recordChanges').collect())).length).toBe(historyAfterRebind.length);

  // Old account lost active owner authority; new verified account can recover via claimInvite.
  expect(await original.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false,
    pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [], branches: [] },
  });
  const recovered = t.withIdentity(identity(email, 'issuer|recovered-owner'));
  await recovered.mutation(staffApi.claimInvite, {});
  expect(await recovered.query(staffApi.myAccess, {})).toMatchObject({
    role: 'owner', companyScope: true, pendingInvitation: null,
  });
  expect(await original.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false, pendingInvitation: null,
  });
  await expect(original.mutation(staffApi.claimInvite, {})).rejects.toThrow('No unclaimed invitation');
});

it('lets a verified desk holder at an old email see and explicitly claim a pending owner invite at their current email, retiring the old desk grant atomically with history and idempotent retries', async () => {
  const { t, owner, samui } = await setupWithOwner();
  const oldEmail = 'alice.old@example.com';
  const newEmail = 'alice.new@example.com';
  const tokenIdentifier = 'issuer|alice';

  const oldDeskId = await owner.mutation(staffApi.setGrant, {
    email: oldEmail, role: 'manager', branchIds: [samui], expectedGrant: null,
  });
  expect(oldDeskId).not.toBeNull();
  await t.withIdentity(identity(oldEmail, tokenIdentifier)).mutation(staffApi.claimInvite, {});

  // Alice changes her verified Clerk email, then deployment admin grants owner to her new email.
  const aliceCurrent = t.withIdentity(identity(newEmail, tokenIdentifier, true));
  const aliceUnverified = t.withIdentity(identity(newEmail, tokenIdentifier, false));
  const ownerInviteId = await t.mutation(ownerApi.grantOwner, { email: newEmail });

  // Unverified identity cannot see or claim the pending owner invite.
  expect(await aliceUnverified.query(staffApi.myAccess, {})).toMatchObject({
    role: null, companyScope: false, branches: [], pendingInvitation: null,
  });
  await expect(aliceUnverified.mutation(staffApi.claimInvite, {})).rejects.toThrow('Verify your email');
  expect(await t.run(ctx => ctx.db.get(oldDeskId!))).not.toBeNull();

  // Verified holder retains desk access and sees the pending owner invitation before explicit claim.
  expect(await aliceCurrent.query(staffApi.myAccess, {})).toMatchObject({
    email: newEmail, role: 'manager', companyScope: false, branches: [{ id: samui }],
    capabilities: { operations: true, manageTeam: false, settings: false },
    pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [], branches: [] },
  });
  expect(await t.run(ctx => accessForIdentity(ctx, identity(newEmail, tokenIdentifier)))).toMatchObject({
    role: 'manager', pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [], branches: [] },
  });
  await expect(aliceCurrent.query(branchApi.list, {})).rejects.toThrow('Not authorized');

  // Explicit claim atomically retires the old desk grant and binds the owner grant.
  await expect(aliceCurrent.mutation(staffApi.claimInvite, {})).resolves.toBeNull();
  expect(await t.run(ctx => ctx.db.get(oldDeskId!))).toBeNull();
  expect(await t.run(ctx => ctx.db.get(ownerInviteId))).toMatchObject({
    email: newEmail, role: 'owner', branchIds: [], tokenIdentifier,
  });
  expect(await aliceCurrent.query(staffApi.myAccess, {})).toMatchObject({
    email: newEmail, role: 'owner', companyScope: true, pendingInvitation: null,
    capabilities: { manageTeam: true, settings: true, marketing: true },
  });

  // Retrying claimInvite is idempotent and does not duplicate history.
  const historyBeforeRetry = await t.run(ctx => ctx.db.query('recordChanges').collect());
  await expect(aliceCurrent.mutation(staffApi.claimInvite, {})).resolves.toBeNull();
  const historyAfterRetry = await t.run(ctx => ctx.db.query('recordChanges').collect());
  expect(historyAfterRetry).toHaveLength(historyBeforeRetry.length);

  expect(historyAfterRetry).toEqual(expect.arrayContaining([
    expect.objectContaining({
      entityType: 'staffGrant', entityId: oldDeskId, actor: newEmail, kind: 'retired',
      before: { email: oldEmail, role: 'manager', branchIds: [samui] },
      after: { replacedByGrantId: ownerInviteId, replacedByEmail: newEmail, replacedByRole: 'owner' },
    }),
    expect.objectContaining({
      entityType: 'staffGrant', entityId: ownerInviteId, actor: newEmail, kind: 'claimed',
      before: { retiredGrantId: oldDeskId, email: oldEmail, role: 'manager', branchIds: [samui] },
      after: { email: newEmail, role: 'owner', branchIds: [] },
    }),
  ]));

  // Old desk email is gone from Team list.
  const people = await owner.query(staffApi.listPeople, {});
  expect(people.find(person => person.email === oldEmail)).toBeUndefined();
  expect(people.find(person => person.email === newEmail)).toMatchObject({
    role: 'owner', staffGrant: { id: ownerInviteId, claimed: true },
  });
});

it('surfaces and claims a pending owner invite even when the old desk grant has only archived branches', async () => {
  const { t, owner } = await setupWithOwner();
  const phuket = await owner.mutation(branchApi.create, {
    key: 'phuket', name: 'Phuket', slug: 'phuket',
    issuer: { legalName: '360 Tour Co., Ltd.', taxId: '0000000000000', branchCode: '00001', address: 'Phuket' },
  });
  const oldEmail = 'cashier.old@example.com';
  const newEmail = 'cashier.new@example.com';
  const tokenIdentifier = 'issuer|cashier-upgraded';

  const oldDeskId = await owner.mutation(staffApi.setGrant, {
    email: oldEmail, role: 'cashier', branchIds: [phuket], expectedGrant: null,
  });
  await t.withIdentity(identity(oldEmail, tokenIdentifier)).mutation(staffApi.claimInvite, {});
  await owner.mutation(internal.branches.branches.setState, { branchId: phuket, revision: 1, state: 'archived' });

  const ownerInviteId = await t.mutation(ownerApi.grantOwner, { email: newEmail });
  const holder = t.withIdentity(identity(newEmail, tokenIdentifier));

  expect(await holder.query(staffApi.myAccess, {})).toMatchObject({
    email: newEmail, role: null, companyScope: false, branches: [],
    pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [], branches: [] },
  });

  await holder.mutation(staffApi.claimInvite, {});
  expect(await t.run(ctx => ctx.db.get(oldDeskId!))).toBeNull();
  expect(await t.run(ctx => ctx.db.get(ownerInviteId))).toMatchObject({ tokenIdentifier, role: 'owner' });
  expect(await holder.query(staffApi.myAccess, {})).toMatchObject({
    role: 'owner', companyScope: true, pendingInvitation: null,
  });
});

it('does not expose or retire an old desk grant for non-owner, revoked, or already-claimed invites at the current email', async () => {
  const { t, owner, samui } = await setupWithOwner();
  const oldEmail = 'staff.old@example.com';
  const newEmail = 'staff.new@example.com';
  const tokenIdentifier = 'issuer|staff-holder';

  const oldDeskId = await owner.mutation(staffApi.setGrant, {
    email: oldEmail, role: 'cashier', branchIds: [samui], expectedGrant: null,
  });
  await t.withIdentity(identity(oldEmail, tokenIdentifier)).mutation(staffApi.claimInvite, {});
  const holder = t.withIdentity(identity(newEmail, tokenIdentifier));

  // Unclaimed non-owner desk invite at newEmail must not appear or retire oldDeskId.
  const deskInviteId = await owner.mutation(staffApi.setGrant, {
    email: newEmail, role: 'manager', branchIds: [samui], expectedGrant: null,
  });
  expect(await holder.query(staffApi.myAccess, {})).toMatchObject({
    role: 'cashier', branches: [{ id: samui }], pendingInvitation: null,
  });
  await expect(holder.mutation(staffApi.claimInvite, {})).rejects.toThrow('No unclaimed invitation');
  expect(await t.run(ctx => ctx.db.get(oldDeskId!))).not.toBeNull();
  expect((await t.run(ctx => ctx.db.get(deskInviteId!)))?.tokenIdentifier).toBeUndefined();

  // Owner invite at newEmail already claimed by someone else must not appear or retire oldDeskId.
  const ownerInviteId = await t.mutation(ownerApi.grantOwner, { email: newEmail });
  await t.withIdentity(identity(newEmail, 'issuer|other-owner')).mutation(staffApi.claimInvite, {});
  expect(await holder.query(staffApi.myAccess, {})).toMatchObject({
    role: 'cashier', branches: [{ id: samui }], pendingInvitation: null,
  });
  await expect(holder.mutation(staffApi.claimInvite, {})).rejects.toThrow('No unclaimed invitation');
  expect(await t.run(ctx => ctx.db.get(oldDeskId!))).not.toBeNull();
  expect((await t.run(ctx => ctx.db.get(ownerInviteId)))?.tokenIdentifier).toBe('issuer|other-owner');
});

it('retires superseded Marketing access on owner claim and preserves another identity at a reassigned address', async () => {
  const { t } = await setupWithOwner();
  const email = 'next-owner@example.com';
  const holder = t.withIdentity(identity(email, 'holder'));
  const previous = t.withIdentity(identity('moved@example.com', 'previous'));
  await t.run(async ctx => {
    const fields = { role: 'viewer' as const, createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com' };
    await ctx.db.insert('marketingGrants', { ...fields, email: 'holder-old@example.com', tokenIdentifier: 'holder' });
    await ctx.db.insert('marketingGrants', { ...fields, email, tokenIdentifier: 'previous' });
  });
  await t.mutation(ownerApi.grantOwner, { email });
  await holder.mutation(staffApi.claimInvite, {});
  await t.mutation(ownerApi.revokeOwner, { email });
  expect(await holder.query(staffApi.myAccess, {})).toMatchObject({ marketingRole: null, role: null, marketingInvitation: null });
  expect(await previous.query(staffApi.myAccess, {})).toMatchObject({ marketingRole: 'viewer', role: null });
});

it('edits and revokes a separate bound Marketing account at an owner address using the displayed revision', async () => {
  const { t, owner } = await setupWithOwner();
  const email = 'reassigned@example.com';
  const marketingApi = api.marketing.access;
  await owner.mutation(marketingApi.setGrant, { email, role: 'viewer', expectedGrant: null });
  await t.withIdentity(identity(email, 'issuer|former-address-holder')).mutation(marketingApi.claimInvite, {});
  const separate = t.withIdentity(identity('moved@example.com', 'issuer|former-address-holder'));
  const newOwner = t.withIdentity(identity(email, 'issuer|owner-address-holder'));
  const staffId = await t.mutation(ownerApi.grantOwner, { email });
  await newOwner.mutation(staffApi.claimInvite, {});
  const readPerson = async () => (await owner.query(staffApi.listPeople, {})).find(row => row.email === email)!;

  const person = await readPerson();
  expect(person).toMatchObject({
    role: 'owner', staffGrant: { id: staffId, claimed: true },
    separateMarketingAccount: true, marketingGrant: { role: 'viewer', claimed: true },
  });
  expect(JSON.stringify(person)).not.toContain('issuer|');
  const { id, revision } = person.marketingGrant!;
  const expectedGrant = { id, revision };
  await expect(owner.mutation(marketingApi.setGrant, { email, role: null, expectedGrant: null })).rejects.toThrow('already has Marketing access');
  await owner.mutation(marketingApi.setGrant, { email, role: 'finance', expectedGrant });
  expect(await separate.query(marketingApi.current, {})).toMatchObject({ role: 'finance' });
  await expect(owner.mutation(marketingApi.setGrant, { email, role: null, expectedGrant })).rejects.toThrow('Marketing access changed');
  await owner.mutation(marketingApi.setGrant, { email, role: null, expectedGrant: { id, revision: revision + 1 } });

  expect(await separate.query(marketingApi.current, {})).toMatchObject({ role: null });
  expect(await newOwner.query(marketingApi.current, {})).toMatchObject({ role: 'admin' });
  expect(await readPerson()).toMatchObject({
    role: 'owner', staffGrant: person.staffGrant,
    separateMarketingAccount: false, marketingGrant: null,
  });
  await expect(owner.mutation(marketingApi.setGrant, { email, role: 'viewer', expectedGrant: null })).rejects.toThrow('Owners are managed by the deployment admin');
});

it.each([undefined, 'issuer|owner@example.com'])('protects an owner row from edits to an unclaimed or same-account Marketing grant (%s)', async tokenIdentifier => {
  const { t, owner } = await setupWithOwner();
  const email = 'owner@example.com';
  const id = await t.run(ctx => ctx.db.insert('marketingGrants', {
    email, role: 'viewer', createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: email,
    ...(tokenIdentifier ? { tokenIdentifier } : {}),
  }));
  const person = (await owner.query(staffApi.listPeople, {})).find(row => row.email === email);
  expect(person).toMatchObject({ role: 'owner', separateMarketingAccount: false, marketingGrant: null });
  for (const role of ['finance', null] as const) {
    await expect(owner.mutation(api.marketing.access.setGrant, { email, role, expectedGrant: { id, revision: 0 } })).rejects.toThrow('Owners are managed by the deployment admin');
  }
  if (!tokenIdentifier) {
    await expect(owner.mutation(api.marketing.access.renewInvitation, { grantId: id, expectedRevision: 0 })).rejects.toThrow('Owners are managed by the deployment admin');
  }
});

it('retires an unclaimed Marketing invitation when its verified recipient claims ownership', async () => {
  const { t, owner } = await setupWithOwner();
  const email = 'invitee@example.com';
  const invitee = t.withIdentity(identity(email));
  await owner.mutation(api.marketing.access.setGrant, { email, role: 'viewer', expectedGrant: null });
  await t.mutation(ownerApi.grantOwner, { email });
  await invitee.mutation(staffApi.claimInvite, {});
  await t.mutation(ownerApi.revokeOwner, { email });
  expect(await invitee.query(staffApi.myAccess, {})).toMatchObject({ role: null, marketingInvitation: null, marketingRole: null });
});
