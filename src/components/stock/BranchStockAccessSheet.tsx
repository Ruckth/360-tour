"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { Callout, EditorSheet } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { parseStockError, STOCK_PAGE_SIZE } from "./stock-format";
import type { StockRoles } from "./stock-types";

type GrantListRow = FunctionReturnType<typeof api.commerce.stock.listGrants>["page"][number];

const ROLE_LABELS: { key: keyof StockRoles; label: string }[] = [
  { key: "requester", label: "Requester" },
  { key: "approver", label: "Approver" },
  { key: "buyer", label: "Buyer" },
  { key: "receiver", label: "Receiver / Counter" },
  { key: "lead", label: "Stock lead" },
];

export function BranchStockAccessSheet({
  branchId,
  branchName,
  onClose,
  onSaved,
}: {
  branchId: Id<"branches">;
  branchName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const policy = useQuery(api.commerce.stock.branchPolicy, { branchId });
  const { results: grants, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.listGrants,
    { branchId },
    { initialNumItems: STOCK_PAGE_SIZE },
  );
  const setBranchPolicy = useMutation(api.commerce.stock.setBranchPolicy);
  const setGrant = useMutation(api.commerce.stock.setGrant);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function togglePolicy(field: "directOrder" | "directReceipt", next: boolean) {
    setError("");
    setBusyId(`policy-${field}`);
    try {
      await setBranchPolicy({
        branchId,
        directOrder: field === "directOrder" ? next : (policy?.directOrder ?? false),
        directReceipt: field === "directReceipt" ? next : (policy?.directReceipt ?? false),
        expectedRevision: policy?.revision ?? 0,
      });
      onSaved("Branch stock policy updated.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not update branch policy.").message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRole(row: GrantListRow, roleKey: keyof StockRoles) {
    setError("");
    setBusyId(`${row.staffGrantId}-${roleKey}`);
    const currentRoles: StockRoles = row.stockGrant?.roles ?? {
      requester: false,
      approver: false,
      buyer: false,
      receiver: false,
      lead: false,
    };
    try {
      await setGrant({
        branchId,
        staffGrantId: row.staffGrantId,
        roles: { ...currentRoles, [roleKey]: !currentRoles[roleKey] },
        expectedRevision: row.stockGrant?.revision ?? 0,
      });
      onSaved(`Updated stock permissions for ${row.email}.`);
    } catch (cause) {
      setError(parseStockError(cause, "Could not update stock grant.").message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={onClose}
      header={
        <>
          <SheetTitle>Branch stock access · {branchName}</SheetTitle>
          <SheetDescription>
            Manage explicit stock grants and direct ordering/receiving policies for this branch.
          </SheetDescription>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-5 py-5 sm:px-6">
          {error ? (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          ) : null}

          <section aria-label="Branch policies" className="grid gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SlidersHorizontal aria-hidden className="size-4" />
              Branch purchasing policies
            </h3>
            <div className="grid gap-2.5 rounded-lg border border-border p-3.5">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={policy?.directOrder ?? false}
                  disabled={policy === undefined || busyId !== null}
                  onChange={(event) => void togglePolicy("directOrder", event.target.checked)}
                  className="mt-0.5 size-4 accent-foreground"
                />
                <span>
                  <strong className="block font-medium text-foreground">Allow direct purchase orders</strong>
                  <span className="text-xs text-muted-foreground">
                    Buyers can create and issue orders without an approved purchase request.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={policy?.directReceipt ?? false}
                  disabled={policy === undefined || busyId !== null}
                  onChange={(event) => void togglePolicy("directReceipt", event.target.checked)}
                  className="mt-0.5 size-4 accent-foreground"
                />
                <span>
                  <strong className="block font-medium text-foreground">Allow direct supplier receipts without PO</strong>
                  <span className="text-xs text-muted-foreground">
                    Receivers can post unplanned supplier deliveries with a reason after checking open orders.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section aria-label="Staff stock grants" className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Staff grants for {branchName}</h3>
            {status === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading staff grants" rows={4} />
            ) : grants.length === 0 ? (
              <EmptyState>No eligible staff members assigned to this branch.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {grants.map((row) => {
                  const roles = row.stockGrant?.roles ?? {
                    requester: false,
                    approver: false,
                    buyer: false,
                    receiver: false,
                    lead: false,
                  };
                  return (
                    <li key={row.staffGrantId} className="grid gap-2.5 rounded-lg border border-border p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{row.email}</span>
                        <span className="text-xs capitalize text-muted-foreground">{row.role}</span>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {ROLE_LABELS.map(({ key, label }) => (
                          <label key={key} className="inline-flex items-center gap-2 text-xs text-foreground">
                            <input
                              type="checkbox"
                              checked={roles[key]}
                              disabled={busyId !== null}
                              onChange={() => void toggleRole(row, key)}
                              className="size-4 accent-foreground"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {status === "CanLoadMore" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
                Load more staff
              </Button>
            ) : null}
          </section>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </EditorSheet>
  );
}
