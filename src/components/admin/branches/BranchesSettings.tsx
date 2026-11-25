"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { BranchState } from "convex/shared/branchTypes";
import { MapPin, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { staffDate } from "@/lib/staff-time";
import { personLabel } from "../person-label";
import { BranchLifecycleDialogs, type BranchLifecycleAction } from "./BranchLifecycleDialogs";
import { BranchProfileDialog } from "./BranchProfileDialog";
import { BranchStatePill, type BranchRow } from "./branch-status";

const STATE_ORDER: Record<BranchState, number> = {
  active: 0,
  setup: 1,
  suspended: 2,
  archived: 3,
};

function sortBranches(rows: readonly BranchRow[]): BranchRow[] {
  return [...rows].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.createdAt - b.createdAt || a.name.localeCompare(b.name),
  );
}

function branchMetaLine(branch: BranchRow): string {
  const actor = personLabel(branch.stateChangedByEmail);
  const when = staffDate(branch.stateChangedAt);
  switch (branch.state) {
    case "active":
      return `Active since ${when} · ${actor}`;
    case "setup":
      return `In setup since ${when} · ${actor}`;
    case "suspended":
      return `Suspended ${when} by ${actor}${branch.stateReason ? ` · “${branch.stateReason}”` : ""}`;
    case "archived":
      return `Archived ${when} by ${actor} · read only`;
  }
}

export function BranchesSettings() {
  const branches = useQuery(api.branches.branches.list, {});
  const [addOpen, setAddOpen] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<Id<"branches"> | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<BranchLifecycleAction | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const sorted = branches ? sortBranches(branches) : undefined;
  const editingBranch = editingBranchId ? (branches?.find((row) => row._id === editingBranchId) ?? null) : null;
  const defaultIssuerSource = sorted?.find((row) => row.state === "active") ?? sorted?.[0];
  const defaultIssuer = defaultIssuerSource
    ? { legalName: defaultIssuerSource.issuer.legalName, taxId: defaultIssuerSource.issuer.taxId }
    : undefined;

  return (
    <section role="region" aria-label="Branches" className="grid max-w-4xl gap-5">
      <header className="flex flex-wrap items-end gap-3 px-1 pt-1">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-serif text-3xl text-foreground">Branches</h2>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            Every location your company operates. Guests only see Active branches. Only company owners change this page.
          </p>
        </div>
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus aria-hidden className="size-4" />
          Add branch
        </Button>
      </header>

      {statusMessage ? (
        <p role="status" className="px-1 text-sm text-muted-foreground">
          {statusMessage}
        </p>
      ) : null}

      {sorted === undefined ? (
        <div className="grid place-items-center py-10">
          <Spinner label="Loading branches" />
        </div>
      ) : sorted.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No branches yet. Add your first branch to begin setup.
        </Card>
      ) : (
        <div className="grid gap-4">
          {sorted.map((branch) => {
            const isArchived = branch.state === "archived";
            const isActive = branch.state === "active";
            const archiveHintId = `branch-archive-hint-${branch._id}`;
            return (
              <Card
                key={branch._id}
                data-testid="branch-card"
                data-branch-key={branch.key}
                data-branch-state={branch.state}
                className="p-5 lg:p-6"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid min-w-0 flex-1 basis-56 gap-1">
                    <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-foreground">
                      <MapPin aria-hidden className="size-4 shrink-0 text-gold-text" />
                      <span>{branch.name}</span>
                      <BranchStatePill state={branch.state} showActive />
                    </h3>
                    <p className="text-[13px] text-muted-foreground">{branchMetaLine(branch)}</p>
                  </div>

                  {!isArchived ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Edit profile for ${branch.name}`}
                        onClick={() => setEditingBranchId(branch._id)}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                        Edit profile
                      </Button>

                      {branch.state === "setup" || branch.state === "suspended" ? (
                        <Button
                          type="button"
                          size="sm"
                          aria-label={`Activate ${branch.name}`}
                          onClick={() => setLifecycleAction({ kind: "activate", branch })}
                        >
                          Activate
                        </Button>
                      ) : null}

                      {isActive ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Suspend ${branch.name}`}
                          onClick={() => setLifecycleAction({ kind: "suspend", branch })}
                        >
                          Suspend
                        </Button>
                      ) : null}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isActive}
                        aria-label={`Archive ${branch.name}`}
                        aria-describedby={isActive ? archiveHintId : undefined}
                        title={isActive ? "Suspend the branch before archiving it." : undefined}
                        onClick={() => setLifecycleAction({ kind: "archive", branch })}
                      >
                        Archive
                      </Button>
                    </div>
                  ) : null}
                </div>

                {isActive ? (
                  <p id={archiveHintId} className="mt-2 text-xs text-muted-foreground">
                    Suspend this branch before archiving it.
                  </p>
                ) : null}

                {branch.state === "setup" ? (
                  <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
                    While in Setup: hidden from guests with live sales off. Assigned staff can configure and preview it while other active branches continue unchanged.
                  </p>
                ) : null}

                {isArchived ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Archived branches are read-only. Profile and state can’t be changed.
                  </p>
                ) : null}

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Key &amp; slug</dt>
                    <dd className="font-mono text-[13px] font-medium text-foreground">
                      {branch.key} · /{branch.slug}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Receipt issuer</dt>
                    <dd className="font-medium text-foreground">{branch.issuer.legalName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tax ID &amp; code</dt>
                    <dd className="font-medium tabular-nums text-foreground">
                      {branch.issuer.taxId} · {branch.issuer.branchCode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Address</dt>
                    <dd className="font-medium text-foreground">{branch.issuer.address}</dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      <p className="px-1 text-[13px] text-muted-foreground">
        Shared by every branch: order and receipt numbers, Asia/Bangkok time and THB.
      </p>

      <BranchProfileDialog
        open={addOpen}
        branch={null}
        defaultIssuer={defaultIssuer}
        onOpenChange={setAddOpen}
        onSaved={setStatusMessage}
      />

      <BranchProfileDialog
        open={editingBranch !== null}
        branch={editingBranch}
        onOpenChange={(open) => {
          if (!open) setEditingBranchId(null);
        }}
        onSaved={setStatusMessage}
      />

      <BranchLifecycleDialogs
        action={lifecycleAction}
        onClose={() => setLifecycleAction(null)}
        onDone={setStatusMessage}
      />
    </section>
  );
}
