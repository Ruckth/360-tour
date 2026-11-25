"use client";

import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { BranchState } from "convex/shared/branchTypes";
import { Building2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import type { Tone } from "../status-tones";

export type BranchRow = FunctionReturnType<typeof api.branches.branches.list>[number];

export const BRANCH_STATE_META: Record<BranchState, { tone: Tone; label: string }> = {
  active: { tone: "muted", label: "Active" },
  setup: { tone: "warning", label: "Setup · hidden from guests" },
  suspended: { tone: "danger", label: "Suspended · no new sales" },
  archived: { tone: "muted", label: "Archived · read only" },
};

const BRANCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRANCH_CODE_PATTERN = /^[0-9]{5}$/;

export function BranchStatePill({
  state,
  showActive = false,
  className,
}: {
  state: BranchState;
  showActive?: boolean;
  className?: string;
}) {
  if (state === "active" && !showActive) return null;
  const meta = BRANCH_STATE_META[state];
  return <StatusBadge tone={meta.tone} label={meta.label} className={className} />;
}

export function BranchPill({
  name,
  company = false,
  className,
}: {
  name: string;
  company?: boolean;
  className?: string;
}) {
  const Icon = company ? Building2 : MapPin;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-xs font-medium text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 text-muted-foreground" />
      {name}
    </span>
  );
}

export function slugifyBranchValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type BranchProfileDraft = {
  key: string;
  name: string;
  slug: string;
  legalName: string;
  taxId: string;
  branchCode: string;
  address: string;
};

export function validateBranchProfile(draft: BranchProfileDraft, { requireKey }: { requireKey: boolean }): string | null {
  if (!draft.name.trim()) return "Enter a branch name.";
  if (requireKey) {
    const key = draft.key.trim().toLowerCase();
    if (key.length > 80 || !BRANCH_SLUG_PATTERN.test(key)) {
      return "Enter a branch key of 1–80 characters using letters, numbers and single hyphens.";
    }
  }
  const slug = draft.slug.trim().toLowerCase();
  if (slug.length > 80 || !BRANCH_SLUG_PATTERN.test(slug)) {
    return "Enter a branch slug of 1–80 characters using letters, numbers and single hyphens.";
  }
  if (!draft.legalName.trim() || !draft.taxId.trim() || !draft.address.trim()) {
    return "Enter the issuer legal name, tax ID and address.";
  }
  if (!BRANCH_CODE_PATTERN.test(draft.branchCode.trim())) {
    return "Enter a five-digit issuer branch code.";
  }
  return null;
}
