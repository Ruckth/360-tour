// @vitest-environment edge-runtime
import { asTestOwner, testMarketingGrantVersion } from './testing/staff.test-support';
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { marketingInvitationExpiry, marketingInvitationExpired } from './marketing/accessPolicy';
import { MARKETING_INVITATION_TTL_MS } from "./shared/marketingPolicy";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const now = Date.parse("2026-11-07T10:00:00Z");
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => { vi.restoreAllMocks(); });

it.each([false, true])("refuses expired invitations (explicit expiry: %s), then refreshes and claims the same row", async explicitExpiry => {
  const t = convexTest(schema, modules);
  const admin = await asTestOwner(t, { emailVerified: true, email: "admin@example.com", tokenIdentifier: "admin" });
  const user = t.withIdentity({ emailVerified: true, email: "friend@example.com", tokenIdentifier: "issuer|friend" });
  const id = await t.run(ctx => ctx.db.insert("marketingGrants", {
    email: "friend@example.com", role: "viewer",
    createdAt: now - MARKETING_INVITATION_TTL_MS,
    // Updating a legacy row's role must not implicitly extend its original invitation.
    updatedAt: now, updatedByEmail: "admin@example.com",
    ...(explicitExpiry ? { inviteExpiresAt: now } : {}),
  }));
  expect(await t.run(async ctx => (await ctx.db.query('marketingGrants').take(10)).map(grant => ({ ...grant, expiresAt: marketingInvitationExpiry(grant), expired: marketingInvitationExpired(grant) })))).toMatchObject([{ expiresAt: now, expired: true }]);
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: null, pendingInvitation: null });
  expect((await user.query(api.auth.staffAccess.myAccess, {})).marketingInvitation).toBeNull();
  await expect(user.mutation(api.marketing.access.claimInvite, {})).rejects.toThrow("Invitation expired");
  expect((await t.run(ctx => ctx.db.get(id)))?.tokenIdentifier).toBeUndefined();
  await admin.mutation(api.marketing.access.setGrant, { email: " FRIEND@example.com ", role: "manager", expectedGrant: { id, revision: 0 } });
  await expect(user.mutation(api.marketing.access.claimInvite, {})).rejects.toThrow("Invitation expired");
  await admin.mutation(api.marketing.access.renewInvitation, { grantId: id, expectedRevision: 1 });
  expect(await t.run(async ctx => (await ctx.db.query('marketingGrants').take(10)).map(grant => ({ ...grant, expiresAt: marketingInvitationExpiry(grant), expired: marketingInvitationExpired(grant) })))).toMatchObject([
    { _id: id, expiresAt: now + MARKETING_INVITATION_TTL_MS, expired: false },
  ]);
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ pendingInvitation: { role: "manager" } });
  expect(await user.query(api.auth.staffAccess.myAccess, {})).toMatchObject({
    marketingInvitation: { role: "manager", expiresAt: now + MARKETING_INVITATION_TTL_MS }, capabilities: { marketing: false },
  });
  await user.mutation(api.marketing.access.claimInvite, {});
  expect(await user.query(api.auth.staffAccess.myAccess, {})).toMatchObject({
    marketingRole: "manager", marketingInvitation: null, capabilities: { marketing: true, checkout: false },
  });
});

it("sets a 14-day deadline on new invitations and accepts one just before expiry", async () => {
  const t = convexTest(schema, modules);
  const admin = await asTestOwner(t, { emailVerified: true, email: "admin@example.com", tokenIdentifier: "admin" });
  const user = t.withIdentity({ emailVerified: true, email: "friend@example.com", tokenIdentifier: "friend" });
  await admin.mutation(api.marketing.access.setGrant, { expectedGrant: null, email: "friend@example.com", role: "finance" });
  expect(await t.run(async ctx => (await ctx.db.query('marketingGrants').take(10)).map(grant => ({ ...grant, expiresAt: marketingInvitationExpiry(grant), expired: marketingInvitationExpired(grant) })))).toMatchObject([{ expiresAt: now + MARKETING_INVITATION_TTL_MS, expired: false }]);
  vi.mocked(Date.now).mockReturnValue(now + MARKETING_INVITATION_TTL_MS - 1);
  await user.mutation(api.marketing.access.claimInvite, {});
  vi.mocked(Date.now).mockReturnValue(now + MARKETING_INVITATION_TTL_MS * 10);
  await user.mutation(api.marketing.access.claimInvite, {});
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: "finance" });
  expect(await t.run(async ctx => (await ctx.db.query('marketingGrants').take(10)).map(grant => ({ ...grant, expiresAt: marketingInvitationExpiry(grant), expired: marketingInvitationExpired(grant) })))).toMatchObject([{ expiresAt: null, expired: false }]);
  await admin.mutation(api.marketing.access.setGrant, { expectedGrant: await testMarketingGrantVersion(admin, "friend@example.com"), email: "friend@example.com", role: "manager" });
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: "manager" });
});

it("rejects stale Marketing role edits, renewals and revocations across claim and replacement", async () => {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { emailVerified: true, email: "owner@example.com", tokenIdentifier: "owner" });
  const email = "friend@example.com";
  const user = t.withIdentity({ emailVerified: true, email, tokenIdentifier: "friend" });
  const access = api.marketing.access;
  const invite = { expectedGrant: null, email, role: "manager" as const };
  await owner.mutation(access.setGrant, invite);
  const first = await testMarketingGrantVersion(owner, email);
  const renew = { grantId: first.id, expectedRevision: first.revision };
  await expect(owner.mutation(access.setGrant, invite)).rejects.toThrow("already has Marketing access");
  await owner.mutation(access.setGrant, { email, role: "viewer", expectedGrant: first });
  await expect(owner.mutation(access.renewInvitation, renew)).rejects.toThrow("Marketing access changed");
  await expect(owner.mutation(access.setGrant, { ...invite, expectedGrant: first })).rejects.toThrow("Marketing access changed");

  const edited = await testMarketingGrantVersion(owner, email);
  await user.mutation(access.claimInvite, {});
  const claimed = await testMarketingGrantVersion(owner, email);
  expect(claimed.revision).toBe(edited.revision + 1);
  await expect(owner.mutation(access.renewInvitation, { grantId: claimed.id, expectedRevision: claimed.revision })).rejects.toThrow("No unclaimed Marketing invitation");
  await expect(owner.mutation(access.setGrant, { email, role: null, expectedGrant: edited })).rejects.toThrow("Marketing access changed");
  expect((await user.query(access.current, {})).role).toBe("viewer");
  await owner.mutation(access.setGrant, { email, role: null, expectedGrant: claimed });
  await expect(owner.mutation(access.renewInvitation, renew)).rejects.toThrow("No unclaimed Marketing invitation");
  await expect(owner.mutation(access.setGrant, { ...invite, expectedGrant: claimed })).rejects.toThrow("Marketing access changed");
  expect((await user.query(access.current, {})).pendingInvitation).toBeNull();

  await owner.mutation(access.setGrant, { ...invite, role: "finance" });
  const replacement = await testMarketingGrantVersion(owner, email);
  expect(replacement.id).not.toBe(first.id);
  expect(replacement.revision).toBe(first.revision);
  await expect(owner.mutation(access.setGrant, { email, role: null, expectedGrant: first })).rejects.toThrow("Marketing access changed");
  await expect(owner.mutation(access.renewInvitation, renew)).rejects.toThrow("No unclaimed Marketing invitation");
  await expect(user.mutation(access.renewInvitation, { grantId: replacement.id, expectedRevision: replacement.revision })).rejects.toThrow("Not authorized");
  expect(await testMarketingGrantVersion(owner, email)).toEqual(replacement);
});

it.each([false, undefined])("denies marketing authority without verification (%s)", async emailVerified => {
  const t = convexTest(schema, modules);
  await t.run(ctx => ctx.db.insert("marketingGrants", {
    email: "friend@example.com", role: "viewer", createdAt: now, updatedAt: now, updatedByEmail: "admin@example.com",
  }));
  const unverifiedAdmin = t.withIdentity({ email: "admin@example.com", ...(emailVerified === undefined ? {} : { emailVerified }), tokenIdentifier: "issuer|fake-admin" });
  expect(await unverifiedAdmin.query(api.marketing.access.current, {})).toMatchObject({ role: null, pendingInvitation: null });
  await expect(unverifiedAdmin.mutation(api.marketing.access.setGrant, { expectedGrant: null, email: "other@example.com", role: "viewer" })).rejects.toThrow();
  const unverified = t.withIdentity({ email: "friend@example.com", ...(emailVerified === undefined ? {} : { emailVerified }), tokenIdentifier: "issuer|friend" });
  expect(await unverified.query(api.marketing.access.current, {})).toMatchObject({ role: null, pendingInvitation: null });
  await expect(unverified.mutation(api.marketing.access.claimInvite, {})).rejects.toThrow("Verify your email");
  const verified = t.withIdentity({ email: "friend@example.com", emailVerified: true, tokenIdentifier: "issuer|friend" });
  await verified.mutation(api.marketing.access.claimInvite, {});
  expect(await verified.query(api.marketing.access.current, {})).toMatchObject({ role: "viewer" });
  // Binding a grant must not let a later token without verification retain access.
  expect(await unverified.query(api.marketing.access.current, {})).toMatchObject({ role: null, pendingInvitation: null });
  await expect(unverified.mutation(api.marketing.access.claimInvite, {})).rejects.toThrow("Verify your email");
});
