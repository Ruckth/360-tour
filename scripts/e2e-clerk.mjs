import { createRequire } from "node:module";
const { createClerkClient } = createRequire(import.meta.url)(
  "@clerk/nextjs/server",
);

/** Dedicated users in a test tenant only. No email, invitation, session impersonation or owner reuse. */
export async function testUsers(env) {
  if (
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
    !env.CLERK_SECRET_KEY?.startsWith("sk_test_")
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
  const discovery = await fetch(new URL('/.well-known/openid-configuration', env.CLERK_JWT_ISSUER_DOMAIN));
  if (!discovery.ok || (await discovery.json()).issuer.replace(/\/$/, '') !== env.CLERK_JWT_ISSUER_DOMAIN.replace(/\/$/, ''))
    throw new Error('Clerk test issuer must be active and match OIDC discovery');
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  const templates = await clerk.jwtTemplates.list();
  if (!templates.data.some((template) => template.name === "convex" && template.claims.aud === "convex"))
    throw new Error(
      "Test tenant requires its convex JWT template (audience convex)",
    );
  const users = {};
  for (const role of ["owner", "cashier", "nonstaff"]) {
    const email = `architecture-e2e-${role}+clerk_test@example.com`;
    const found = await clerk.users.getUserList({ emailAddress: [email] });
    let user = found.data[0];
    if (user && user.privateMetadata?.architectureE2E !== true)
      throw new Error(
        "Dedicated E2E identity collision; refusing existing human account",
      );
    if (!user)
      user = await clerk.users.createUser({
        emailAddress: [email],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
        privateMetadata: { architectureE2E: true },
      });
    users[role] = { email, id: user.id };
  }
  const existingSessions = new Set();
  for (const user of Object.values(users)) {
    const sessions = await clerk.sessions.getSessionList({ userId: user.id, status: 'active', limit: 100 });
    for (const session of sessions.data) existingSessions.add(session.id);
  }
  return { users, async cleanupSessions() {
    for (const user of Object.values(users)) {
      const sessions = await clerk.sessions.getSessionList({ userId: user.id, status: 'active', limit: 100 });
      for (const session of sessions.data) if (!existingSessions.has(session.id)) await clerk.sessions.revokeSession(session.id);
    }
  } };
}
