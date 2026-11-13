import { afterEach, describe, expect, it, vi } from "vitest";
import { testUsers } from "../../scripts/e2e-clerk.mjs";

const issuer = "https://clerk-tests.example.test";
const env = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    "pk_test_" + Buffer.from("clerk-tests.example.test$").toString("base64"),
  CLERK_SECRET_KEY: "sk_test_invented",
  CLERK_JWT_ISSUER_DOMAIN: issuer,
};

afterEach(() => vi.unstubAllGlobals());

function testTenant() {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ issuer })));
  const activeUsers = new Set<string>(["existing-human"]);
  const created: { id: string; email: string; runId: string }[] = [];
  const deleteUser = vi.fn(async (id: string) => {
    activeUsers.delete(id);
  });
  const createUser = vi.fn(async (options: {
    emailAddress: string[];
    privateMetadata: { architectureE2E: boolean; runId: string };
  }) => {
    const id = `created-${created.length}`;
    activeUsers.add(id);
    created.push({ id, email: options.emailAddress[0], runId: options.privateMetadata.runId });
    return { id };
  });
  const client = {
    users: { createUser, deleteUser },
    jwtTemplates: {
      list: async () => ({ data: [{ name: "convex", claims: { aud: "convex" } }] }),
    },
  };
  return { client, activeUsers, created, createUser, deleteUser };
}

describe("Clerk test-user ownership", () => {
  it("isolates overlapping runs and deletes only each run's own accounts and sessions", async () => {
    const tenant = testTenant();
    const first = await testUsers(env, () => tenant.client);
    const second = await testUsers(env, () => tenant.client);
    expect(new Set(tenant.created.map((user) => user.email)).size).toBe(6);
    expect(new Set(tenant.created.map((user) => user.runId)).size).toBe(2);
    expect(tenant.created.every((user) => user.email.split("@")[0].length <= 64)).toBe(true);
    await first.cleanupSessions();
    expect([...tenant.activeUsers].sort()).toEqual([
      "existing-human", ...Object.values(second.users).map((user) => user.id),
    ].sort());
    await first.cleanupSessions();
    expect(tenant.deleteUser).toHaveBeenCalledTimes(3);
    await second.cleanupSessions();
    expect([...tenant.activeUsers]).toEqual(["existing-human"]);
  });

  it("cleans accounts already created when later provisioning fails", async () => {
    const tenant = testTenant();
    tenant.createUser.mockImplementationOnce(async () => {
      tenant.activeUsers.add("partial-run");
      return { id: "partial-run" };
    }).mockRejectedValueOnce(new Error("Provisioning refused"));
    await expect(testUsers(env, () => tenant.client)).rejects.toThrow("Provisioning refused");
    expect(tenant.deleteUser).toHaveBeenCalledExactlyOnceWith("partial-run");
    expect([...tenant.activeUsers]).toEqual(["existing-human"]);
  });
});
