/// <reference types="vite/client" />
import { seedTestBranch } from '../../convex/testing/staff.test-support';
import { convexTest } from "convex-test";
import { useEffect, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import schema from "../../convex/schema";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { resolveCommerceSettings } from "../../convex/commerce/model";
import type { CheckoutBackend, CommerceAccess } from "@/components/checkout/backend";
import { cutoverAccess, payDeskCommerce, pinLoadedAccess } from "@/components/checkout/pay-desk-backend";
import { deviceKey, randomKey } from "@/components/checkout/pay-desk";
import { track } from "./checkout-act";

/*
 * The pay desk on the real backend, in process: the registered Convex functions over a convex-test
 * database, with the same adapter the live checkout uses (payDeskCommerce). Only the reads and
 * writes the pay panel needs are wired. Settings rows are test data; every payment step crosses a
 * registered function. `loseNext(name)` drops one answer after the write commits, like a dropped
 * connection.
 */

type Role = "manager" | "cashier";
export async function createPayDeskBackend(options: { mode?: "direct" | "attempts"; paused?: boolean; role?: Role; email?: string; liveAccess?: boolean; cutover?: { revision: number } } = {}) {
  const t = convexTest(schema, import.meta.glob("../../convex/**/*.ts"));
  let staff = { role: options.role ?? "manager", email: options.email ?? "ploy@example.com" };
  const identity = () => ({ emailVerified: true, email: staff.email, tokenIdentifier: `https://test.clerk.dev|${staff.email}` });
  async function grant() {
    await t.run(async (ctx) => {
      const old = await ctx.db.query("staffGrants").withIndex("by_email", (q) => q.eq("email", staff.email)).unique();
      const fields = { branchIds: [await seedTestBranch(ctx)], email: staff.email, tokenIdentifier: identity().tokenIdentifier, role: staff.role, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: "system:seed" };
      if (old) await ctx.db.patch(old._id, fields);
      else await ctx.db.insert("staffGrants", fields);
    });
  }
  await grant();
  const settingsId = await t.run((ctx) => ctx.db.insert("commerceSettings", {
    key: "default", ...resolveCommerceSettings(null), paymentsMode: options.mode ?? "attempts",
    ...(options.paused ? { cutover: { pausedAt: Date.now(), actor: "owner" } } : {}),
    ...(options.cutover ? { cutover: { pausedAt: Date.now() - 60_000, activatedAt: Date.now(), actor: "owner", revision: options.cutover.revision } } : {}),
  }));

  let version = 0;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
  type Q = FunctionReference<"query">;
  const cache = new Map<string, { ref: Q; args: Record<string, unknown>; value: unknown; error?: unknown }>();
  async function load(entry: NonNullable<ReturnType<typeof cache.get>>) {
    try {
      entry.value = await t.withIdentity(identity()).query(entry.ref, entry.args as FunctionArgs<Q>);
      entry.error = undefined;
    } catch (error) {
      entry.error = error;
    }
  }
  async function refresh() {
    await Promise.all([...cache.values()].map(load));
    version++;
    for (const fn of listeners) fn();
  }
  function useRead<R extends Q>(ref: R, args: FunctionArgs<R> | "skip"): FunctionReturnType<R> | undefined {
    useSyncExternalStore(subscribe, () => version, () => version);
    const key = args === "skip" ? "" : JSON.stringify([getFunctionName(ref), args]);
    let entry = cache.get(key);
    if (key && !entry && args !== "skip") {
      entry = { ref, args: args as Record<string, unknown>, value: undefined };
      cache.set(key, entry);
    }
    useEffect(() => {
      if (entry && entry.value === undefined && !entry.error) void track(load(entry).then(() => { version++; for (const fn of listeners) fn(); }));
    }, [entry]);
    if (entry?.error) throw entry.error;
    return entry?.value as FunctionReturnType<R> | undefined;
  }

  const lose = new Set<string>();
  const first = new Map<string, (args: unknown) => Promise<unknown>>();
  const calls: { name: string; args: unknown }[] = [];
  const mutate = <F extends FunctionReference<"mutation">>(ref: F) => (args: FunctionArgs<F>) => track((async () => {
    const name = getFunctionName(ref);
    const other = first.get(name);
    if (other) { first.delete(name); await other(args); }
    calls.push({ name, args });
    const result = await t.withIdentity(identity()).mutation(ref as FunctionReference<"mutation">, args as Record<string, unknown>);
    await refresh();
    if (lose.delete(name)) throw new Error("Connection lost");
    return result as FunctionReturnType<F>;
  })());
  let access: CommerceAccess = {
    settingsRevision: 0, switches: { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" },
    canSell: { products: false, vouchers: false, sessionPackages: false, mixedPackages: false },
    paymentsMode: options.mode ?? "attempts", paused: Boolean(options.paused), tillReady: true,
  };
  const transport = { useMutation: mutate, useQuery: useRead };
  // liveAccess: the cutover lane's reader and acknowledgement, exactly as the live checkout wires them.
  // Otherwise: this page loaded on an acknowledged till, as the cutover reader leaves it.
  const revision = options.cutover?.revision ?? 0;
  /** A browser's till, admitted by the cutover's own acknowledgement (this browser's by default). */
  async function acknowledgedTill(key = deviceKey()) {
    const { tillId } = await t.withIdentity(identity()).mutation(api.commerce.paymentCutover.acknowledge, { deviceKey: key, loadedMode: "attempts", loadedRevision: revision });
    return tillId;
  }
  if (!options.liveAccess && (options.mode ?? "attempts") === "attempts") localStorage.setItem("checkout.tillId", await acknowledgedTill());
  const commerce = payDeskCommerce(transport, options.liveAccess ? cutoverAccess(transport) : () => {
    useSyncExternalStore(subscribe, () => version, () => version);
    pinLoadedAccess(access.paymentsMode, access.paymentsMode === "attempts" ? revision : null);
    return access;
  });
  const core = {
    settleOrder: mutate(api.pos.commands.settleOrder.settleOrder),
    noteCouponRefusal: mutate(api.marketing.report.noteCouponRefusal),
    recheckOrderCoupon: mutate(api.pos.commands.recheckOrderCoupon.recheckOrderCoupon),
    removeOrderCoupon: mutate(api.pos.commands.removeOrderCoupon.removeOrderCoupon),
  };
  const backend = {
    useActions: () => core,
    useOrder: (orderId: Id<"orders"> | null) => useRead(api.pos.orders.getOrder, orderId ? { orderId } : "skip"),
    useOrderApprovals: (orderId: Id<"orders"> | null) => useRead(api.pos.staffApprovals.forOrder, orderId ? { orderId } : "skip"),
    commerce,
  } as unknown as CheckoutBackend;

  const as = () => t.withIdentity(identity());
  return Object.assign(backend, {
    t,
    calls,
    refresh,
    /** The next answer from this function (e.g. "pos/commands/recordPaymentLeg:recordPaymentLeg") is lost after it commits. */
    loseNext: (name: string) => { lose.add(name); },
    /**
     * Another tab on this till sends the same call just before this panel's next one (a race):
     * `send` receives the panel's arguments and runs before them, without refreshing this page.
     */
    sendFirst: (name: string, send: (args: unknown) => Promise<unknown>) => { first.set(name, send); },
    /** As the same staff member, without refreshing this page's reads. */
    rawMutation: <F extends FunctionReference<"mutation">>(ref: F, args: FunctionArgs<F>) =>
      t.withIdentity(identity()).mutation(ref as FunctionReference<"mutation">, args as Record<string, unknown>) as Promise<FunctionReturnType<F>>,
    /** A new page load: nothing read so far is kept, so every reader starts from loading. */
    forget: () => { cache.clear(); version++; },
    async order(items: { name: string; price: number }[]) {
      let orderId: Id<"orders"> | undefined;
      for (const item of items) ({ orderId } = await as().mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: "extra", ...item } }));
      await refresh();
      return orderId!;
    },
    async setStaff(next: { role: Role; email: string }) {
      staff = next;
      await grant();
      await refresh();
    },
    async setAccess(patch: Partial<CommerceAccess>) {
      access = { ...access, ...patch };
      await t.run((ctx) => ctx.db.patch(settingsId, { paymentsMode: access.paymentsMode }));
      await refresh();
    },
    /** Another till's request on the same database, as its own staff member. */
    otherTill(email: string) {
      return {
        mutation: async <F extends FunctionReference<"mutation">>(ref: F, args: FunctionArgs<F>) => {
          const result = await t.withIdentity({ emailVerified: true, email, tokenIdentifier: `https://test.clerk.dev|${email}` })
            .mutation(ref as FunctionReference<"mutation">, args as Record<string, unknown>);
          await refresh();
          return result as FunctionReturnType<F>;
        },
      };
    },
    async attempts() {
      return t.run((ctx) => ctx.db.query("paymentAttempts").take(20));
    },
    async payments() {
      return t.run((ctx) => ctx.db.query("orderPayments").take(20));
    },
    /** Another browser's till that acknowledged the new panel: its tab and the load it starts attempts under. */
    async otherAcknowledgedTill() {
      const key = randomKey();
      const tillId = await acknowledgedTill(key);
      return { tillId, tabKey: randomKey(), load: { tillId, deviceKey: key, loadedMode: "attempts" as const, loadedRevision: revision } };
    },
    async tills() {
      return t.run((ctx) => ctx.db.query("tills").take(5));
    },
    async orderDoc(orderId: Id<"orders">) {
      return t.run((ctx) => ctx.db.get(orderId));
    },
  });
}
