"use client";

import { api } from "convex/_generated/api";
import { useMutation, usePaginatedQuery } from "convex/react";
import { Archive, Edit3, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { BusinessFactFormDialog, type FactFormTarget } from "@/components/admin/BusinessFactFormDialog";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  EmptyState,
  STACKED_TABLE,
  SkeletonRows,
} from "@/components/admin/admin-bulk";
import {
  BUSINESS_FACT_STATUSES,
  type AdminBusinessFact,
  type AdminFactProperty,
  type BusinessFactStatus,
  factScopeLabel,
} from "@/components/admin/business-facts-form";
import { STATUS_LABELS } from "@/components/admin/labels";
import { statusMeta } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
type FactStatusFilter = BusinessFactStatus | "all";
const FACT_FILTERS: readonly FactStatusFilter[] = [...BUSINESS_FACT_STATUSES, "all"];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function BusinessFactsPanel({ properties }: { properties: readonly AdminFactProperty[] }) {
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useState<FactStatusFilter>("approved");
  const [target, setTarget] = useState<FactFormTarget | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const facts = usePaginatedQuery(
    api.businessFacts.adminList,
    { status: statusFilter === "all" ? undefined : statusFilter },
    { initialNumItems: PAGE_SIZE },
  );
  const setStatus = useMutation(api.businessFacts.adminSetStatus);
  const rows = facts.results as AdminBusinessFact[];

  async function runSetStatus(fact: AdminBusinessFact, status: BusinessFactStatus, confirmArchive: boolean) {
    if (confirmArchive) {
      const confirmed = await confirm({
        title: "Archive this fact?",
        description: `"${fact.title}" will stop being used by the concierge until it is restored.`,
        confirmLabel: "Archive",
      });
      if (!confirmed) return;
    }
    setPendingAction(`${status}:${fact._id}`);
    setActionError("");
    try {
      await setStatus({ factId: fact._id, status, expectedRevision: fact.revision });
    } catch (error) {
      setActionError(errorMessage(error, "Unable to update the fact."));
    } finally {
      setPendingAction("");
    }
  }

  function emptyState() {
    if (statusFilter === "approved") {
      return (
        <EmptyState
          action={
            <Button type="button" size="sm" onClick={() => setTarget({})}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add a fact
            </Button>
          }
        >
          No approved facts yet. Add one so the concierge can answer from verified information.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setStatusFilter("approved")}>
            Show approved facts
          </Button>
        }
      >
        No {statusFilter === "all" ? "" : `${STATUS_LABELS.businessFact[statusFilter].toLowerCase()} `}facts.
      </EmptyState>
    );
  }

  return (
    <div>
      {actionError ? (
        <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
          {actionError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FactStatusFilter)}>
          <SelectTrigger className="h-9 w-[10rem] rounded-lg" aria-label="Fact status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FACT_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {status === "all" ? "All" : STATUS_LABELS.businessFact[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" className="sm:ml-auto" onClick={() => setTarget({})}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add a fact
        </Button>
      </div>

      {facts.status === "LoadingFirstPage" ? (
        <SkeletonRows label="Loading business facts" />
      ) : rows.length === 0 ? (
        emptyState()
      ) : (
        <div className="lg:overflow-x-auto">
          <table className={STACKED_TABLE.table}>
            <thead className={STACKED_TABLE.head}>
              <tr>
                <th className={STACKED_TABLE.th}>Fact</th>
                <th className={STACKED_TABLE.th}>Search terms</th>
                <th className={STACKED_TABLE.th}>Scope</th>
                <th className={STACKED_TABLE.th}>Source</th>
                <th className={STACKED_TABLE.th}>Status</th>
                <th className={STACKED_TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {rows.map((fact) => {
                const archived = fact.status === "archived";
                const approved = fact.status === "approved";
                return (
                  <tr key={fact._id} className={STACKED_TABLE.row}>
                    <td className={cn(STACKED_TABLE.cell, "lg:max-w-[360px]")}>
                      <p className="font-medium text-foreground">{fact.title}</p>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{fact.body}</p>
                    </td>
                    <td
                      data-label="Search terms"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[220px]")}
                    >
                      <p className="line-clamp-3 text-xs">{fact.searchText}</p>
                    </td>
                    <td
                      data-label="Scope"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground")}
                    >
                      {factScopeLabel(fact.propertyId, properties)}
                    </td>
                    <td
                      data-label="Source"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[200px]")}
                    >
                      <p className="line-clamp-2 text-xs">{fact.source}</p>
                    </td>
                    <td className={STACKED_TABLE.cell}>
                      <StatusBadge {...statusMeta("businessFact", fact.status)} />
                    </td>
                    <td className={STACKED_TABLE.cell}>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setTarget({ fact })}>
                          <Edit3 aria-hidden="true" className="h-4 w-4" />
                          Edit
                        </Button>
                        {!approved ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={pendingAction === `approved:${fact._id}`}
                            onClick={() => void runSetStatus(fact, "approved", false)}
                          >
                            {pendingAction === `approved:${fact._id}` ? (
                              <Spinner label="Approving" className="text-current" />
                            ) : (
                              <RotateCcw aria-hidden="true" className="h-4 w-4" />
                            )}
                            {archived ? "Restore & approve" : "Approve"}
                          </Button>
                        ) : null}
                        {!archived ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pendingAction === `archived:${fact._id}`}
                            onClick={() => void runSetStatus(fact, "archived", true)}
                          >
                            <Archive aria-hidden="true" className="h-4 w-4" />
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {facts.status === "CanLoadMore" || facts.status === "LoadingMore" ? (
        <div className="border-t border-border p-3 text-center">
          <Button
            size="sm"
            variant="outline"
            disabled={facts.status === "LoadingMore"}
            onClick={() => facts.loadMore(PAGE_SIZE)}
          >
            {facts.status === "LoadingMore" ? <Spinner label="Loading more facts" className="text-current" /> : null}
            Load more
          </Button>
        </div>
      ) : null}

      <BusinessFactFormDialog target={target} properties={properties} onClose={() => setTarget(null)} />
    </div>
  );
}
