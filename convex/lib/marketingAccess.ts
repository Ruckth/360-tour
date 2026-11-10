import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { adminEmails } from "./adminAuth";
export type MarketingRole = Doc<"marketingGrants">["role"];
export type MarketingPermission =
  | "view"
  | "draft"
  | "publish"
  | "spend"
  | "partners"
  | "reviewCredits"
  | "manageAccess";
export function marketingCapabilities(role: MarketingRole | "admin" | null) {
  return {
    view: role !== null,
    draft: role === "admin" || role === "manager" || role === "marketer",
    publish: role === "admin" || role === "manager",
    spend: role === "admin" || role === "manager" || role === "finance",
    partners: role === "admin" || role === "manager",
    reviewCredits: role === "admin" || role === "finance",
    manageAccess: role === "admin",
  };
}
export async function marketingAccess(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const email = identity?.email?.trim().toLowerCase() ?? null;
  if (email && adminEmails().has(email))
    return {
      email: identity!.email!,
      role: "admin" as const,
      capabilities: marketingCapabilities("admin"),
      pendingInvitation: null,
    };
  const grant = identity
    ? await ctx.db
        .query("marketingGrants")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", identity.tokenIdentifier),
        )
        .unique()
    : null;
  const invite =
    email && !grant
      ? await ctx.db
          .query("marketingGrants")
          .withIndex("by_email", (q) => q.eq("email", email))
          .unique()
      : null;
  const role = grant?.role ?? null;
  return {
    email,
    role,
    capabilities: marketingCapabilities(role),
    pendingInvitation:
      invite && !invite.tokenIdentifier ? { role: invite.role } : null,
  };
}
export async function requireMarketingPermission(
  ctx: QueryCtx | MutationCtx,
  permission: MarketingPermission,
) {
  const access = await marketingAccess(ctx);
  if (!access.email) throw new Error("Not authenticated");
  if (!access.capabilities[permission]) throw new Error("Not authorized");
  return { ...access, email: access.email };
}
export function requireEditableDraft(
  access: { role: MarketingRole | "admin" | null },
  existing: { status: string } | null,
) {
  if (access.role === "marketer" && existing && existing.status !== "draft")
    throw new Error("Marketers may edit drafts only");
}
