// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { MARKETING_INVITATION_TTL_MS } from "./shared/marketingPolicy";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const now = Date.parse("2026-11-07T10:00:00Z");
beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([false, true])("refuses expired invitations (explicit expiry: %s), then refreshes and claims the same row", async explicitExpiry => {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin" });
  const user = t.withIdentity({ email: "friend@example.com", tokenIdentifier: "issuer|friend" });
  const id = await t.run(ctx => ctx.db.insert("marketingGrants", {
    email: "friend@example.com", role: "viewer",
    createdAt: now - MARKETING_INVITATION_TTL_MS,
    // Updating a legacy row's role must not implicitly extend its original invitation.
    updatedAt: now, updatedByEmail: "admin@example.com",
    ...(explicitExpiry ? { inviteExpiresAt: now } : {}),
  }));
  expect(await admin.query(api.marketing.access.listGrants, {})).toMatchObject([{ expiresAt: now, expired: true }]);
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: null, pendingInvitation: null });
  await expect(user.mutation(api.marketing.access.claimInvite, {})).rejects.toThrow("Invitation expired");
  expect((await t.run(ctx => ctx.db.get(id)))?.tokenIdentifier).toBeUndefined();
  await admin.mutation(api.marketing.access.setGrant, { email: " FRIEND@example.com ", role: "manager" });
  expect(await admin.query(api.marketing.access.listGrants, {})).toMatchObject([
    { _id: id, expiresAt: now + MARKETING_INVITATION_TTL_MS, expired: false },
  ]);
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ pendingInvitation: { role: "manager" } });
  await user.mutation(api.marketing.access.claimInvite, {});
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: "manager" });
});

it("sets a 14-day deadline on new invitations and accepts one just before expiry", async () => {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin" });
  const user = t.withIdentity({ email: "friend@example.com", tokenIdentifier: "friend" });
  await admin.mutation(api.marketing.access.setGrant, { email: "friend@example.com", role: "finance" });
  expect(await admin.query(api.marketing.access.listGrants, {})).toMatchObject([{ expiresAt: now + MARKETING_INVITATION_TTL_MS, expired: false }]);
  vi.mocked(Date.now).mockReturnValue(now + MARKETING_INVITATION_TTL_MS - 1);
  await user.mutation(api.marketing.access.claimInvite, {});
  vi.mocked(Date.now).mockReturnValue(now + MARKETING_INVITATION_TTL_MS * 10);
  await user.mutation(api.marketing.access.claimInvite, {});
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: "finance" });
  expect(await admin.query(api.marketing.access.listGrants, {})).toMatchObject([{ expiresAt: null, expired: false }]);
  await admin.mutation(api.marketing.access.setGrant, { email: "friend@example.com", role: "manager" });
  expect(await user.query(api.marketing.access.current, {})).toMatchObject({ role: "manager" });
});
