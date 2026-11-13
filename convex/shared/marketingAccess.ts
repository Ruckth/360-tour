import type { Doc } from '../_generated/dataModel';

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
