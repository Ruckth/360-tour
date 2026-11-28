"use client";

import { useMemo } from "react";
import { useQueries, type RequestForQueries } from "convex/react";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useAdminBranch } from "@/components/admin/branch/branch-context";

const countQuery = api.commerce.purchasing.openHoldCount;

/** A failed or inaccessible purchasing count must leave navigation and POS approvals usable. */
export function useOpenHoldLabel() {
  const { current } = useAdminBranch();
  const branchId = current?.id;
  const requests = useMemo((): RequestForQueries => branchId ? { holds: { query: countQuery, args: { branchId } } } : {}, [branchId]);
  const { holds } = useQueries(requests) as {
    holds?: FunctionReturnType<typeof countQuery> | Error;
  };
  if (!holds || holds instanceof Error || !(holds.count > 0)) return null;
  return `${holds.count}${holds.capped ? "+" : ""} open ${holds.count === 1 && !holds.capped ? "hold" : "holds"}`;
}

export function OpenHoldBadge({ compact = false }: { compact?: boolean }) {
  const label = useOpenHoldLabel();
  if (!label) return null;
  return (
    <span title={label} className="ml-1 text-xs font-medium text-gold-text">
      {compact ? <><span aria-hidden>{label.split(" ")[0]}</span><span className="sr-only"> {label}</span></> : label}
    </span>
  );
}
