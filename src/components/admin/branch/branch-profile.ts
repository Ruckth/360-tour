import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type BranchRow = FunctionReturnType<typeof api.branches.branches.list>[number];

const BRANCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRANCH_CODE_PATTERN = /^[0-9]{5}$/;

export function slugifyBranchValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type BranchProfileDraft = {
  name: string;
  slug: string;
  legalName: string;
  taxId: string;
  branchCode: string;
  address: string;
};

/** The first problem in a branch profile, with the field it belongs to; null when it can be saved. */
export type BranchProfileProblem = { field: keyof BranchProfileDraft; message: string };

export function validateBranchProfile(draft: BranchProfileDraft): BranchProfileProblem | null {
  if (!draft.name.trim()) return { field: "name", message: "Enter a branch name." };
  const slug = draft.slug.trim().toLowerCase();
  if (slug.length > 80 || !BRANCH_SLUG_PATTERN.test(slug)) {
    return { field: "slug", message: "Enter a URL slug of 1–80 characters using letters, numbers and single hyphens." };
  }
  const issuerMessage = "Enter the issuer legal name, tax ID and address.";
  if (!draft.legalName.trim()) return { field: "legalName", message: issuerMessage };
  if (!draft.taxId.trim()) return { field: "taxId", message: issuerMessage };
  if (!draft.address.trim()) return { field: "address", message: issuerMessage };
  if (!BRANCH_CODE_PATTERN.test(draft.branchCode.trim())) {
    return { field: "branchCode", message: "Enter a five-digit issuer branch code." };
  }
  return null;
}
