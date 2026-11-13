import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { createClerkClient } = createRequire(import.meta.url)(
  "@clerk/nextjs/server",
);

/**
 * @typedef {{users: {createUser: (options: {emailAddress: string[], skipPasswordRequirement: boolean, skipLegalChecks: boolean, privateMetadata: {architectureE2E: boolean, runId: string}}) => Promise<{id: string}>, deleteUser: (id: string) => Promise<unknown>}, jwtTemplates: {list: () => Promise<{data: {name: string, claims: {aud?: unknown}}[]}>}}} TestClerkClient
 */
/**
 * Dedicated users in a test tenant only. No email, invitation, session impersonation or owner reuse.
 * @param {Record<string, string | undefined>} env
 * @param {(options: {secretKey: string, publishableKey: string}) => TestClerkClient} createClient
 */
export async function testUsers(env, createClient = createClerkClient) {
  if (
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
    !env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
    !env.CLERK_JWT_ISSUER_DOMAIN
  ) {
    throw new Error(
      "E2E requires Clerk test-tenant publishable and secret keys",
    );
  }
  const host = Buffer.from(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice(8),
    "base64",
  )
    .toString()
    .replace(/\$$/, "");
  if (new URL(env.CLERK_JWT_ISSUER_DOMAIN).host !== host)
    throw new Error("Clerk test issuer and publishable key must match");
  const discovery = await fetch(
    new URL("/.well-known/openid-configuration", env.CLERK_JWT_ISSUER_DOMAIN),
  );
  if (
    !discovery.ok ||
    (await discovery.json()).issuer.replace(/\/$/, "") !==
      env.CLERK_JWT_ISSUER_DOMAIN.replace(/\/$/, "")
  )
    throw new Error(
      "Clerk test issuer must be active and match OIDC discovery",
    );
  const clerk = createClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  const templates = await clerk.jwtTemplates.list();
  if (
    !templates.data.some(
      (template) =>
        template.name === "convex" && template.claims.aud === "convex",
    )
  )
    throw new Error(
      "Test tenant requires its convex JWT template (audience convex)",
    );
  const runId = randomUUID();
  /** @type {Record<string, {email: string, id: string}>} */
  const users = {};
  /** @type {Set<string>} */
  const ownedUsers = new Set();
  async function cleanupSessions() {
    let failures = 0;
    for (const id of ownedUsers) {
      try {
        // Deleting this invocation's user also revokes its sessions. Shared users are never read.
        await clerk.users.deleteUser(id);
        ownedUsers.delete(id);
      } catch {
        failures += 1;
      }
    }
    if (failures)
      throw new Error(`Failed to remove ${failures} run-owned Clerk test users`);
  }
  try {
    for (const role of ["owner", "cashier", "nonstaff"]) {
      const email = `arch-e2e-${role}-${runId.replaceAll("-", "")}+clerk_test@example.com`;
      const user = await clerk.users.createUser({
        emailAddress: [email],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
        privateMetadata: { architectureE2E: true, runId },
      });
      ownedUsers.add(user.id);
      users[role] = { email, id: user.id };
    }
  } catch (error) {
    await cleanupSessions();
    throw error;
  }
  return {
    users,
    cleanupSessions,
  };
}
