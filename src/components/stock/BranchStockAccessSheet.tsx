"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Check, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, SearchBox, SkeletonRows, useDebounced } from "@/components/admin/admin-bulk";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Callout, EditorSheet } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { parseOptionalSatang, parseStockError, STOCK_PAGE_SIZE } from "./stock-format";
import type { StockRoles } from "./stock-types";

type GrantListRow = FunctionReturnType<typeof api.commerce.stock.listGrants>["page"][number];

const ROLE_META: { key: keyof StockRoles; label: string; shortLabel: string; description: string }[] = [
  {
    key: "requester",
    label: "Requester",
    shortLabel: "Requester",
    description: "Creates and submits purchase requests and branch stock transfers.",
  },
  {
    key: "approver",
    label: "Approver",
    shortLabel: "Approver",
    description: "Approves, sends back, or declines submitted purchase requests.",
  },
  {
    key: "buyer",
    label: "Buyer",
    shortLabel: "Buyer",
    description: "Manages suppliers, creates and issues purchase orders, and dispatches transfers.",
  },
  {
    key: "receiver",
    label: "Receiver / Counter",
    shortLabel: "Receiver",
    description: "Receives deliveries, records opening stock, and posts physical shelf counts.",
  },
  {
    key: "lead",
    label: "Stock lead",
    shortLabel: "Stock lead",
    description: "Posts adjustments, resolves problem reports, corrects movements, and manages lots.",
  },
];

const MAX_AUTO_ADVANCE_PAGES = 4;

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
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const searchTerm = useDebounced(search.trim(), 200);
  const policy = useQuery(api.commerce.stock.branchPolicy, { branchId });
  const { results: grants, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.listGrants,
    { branchId, ...(searchTerm ? { search: searchTerm } : {}) },
    { initialNumItems: STOCK_PAGE_SIZE },
  );
  const queryKey = `${branchId}|${searchTerm}`;
  const [autoStep, setAutoStep] = useState<{ key: string; count: number }>({ key: queryKey, count: 0 });
  const currentAutoSteps = autoStep.key === queryKey ? autoStep.count : 0;
  const shouldAutoAdvance =
    grants.length === 0 && status === "CanLoadMore" && currentAutoSteps < MAX_AUTO_ADVANCE_PAGES;
  const emptyContinuationPaused =
    grants.length === 0 && status === "CanLoadMore" && currentAutoSteps >= MAX_AUTO_ADVANCE_PAGES;

  useEffect(() => {
    if (!shouldAutoAdvance) return;
    const timer = setTimeout(() => {
      setAutoStep({ key: queryKey, count: currentAutoSteps + 1 });
      loadMore(STOCK_PAGE_SIZE);
    }, 0);
    return () => clearTimeout(timer);
  }, [shouldAutoAdvance, queryKey, currentAutoSteps, loadMore]);
  const setBranchPolicy = useMutation(api.commerce.stock.setBranchPolicy);
  const setGrant = useMutation(api.commerce.stock.setGrant);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const [optimisticRoles, setOptimisticRoles] = useState<Record<string, StockRoles>>({});
  const [optimisticPolicy, setOptimisticPolicy] = useState<{
    directOrder?: boolean;
    directReceipt?: boolean;
    separateReceiving?: boolean;
  }>({});
  const [error, setError] = useState("");
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const staffQueuesRef = useRef<
    Map<Id<"staffGrants">, { tail: Promise<void>; roles: StockRoles; revision: number; inFlight: number; aborted: boolean }>
  >(new Map());
  const policyQueueRef = useRef<{
    tail: Promise<void>;
    directOrder: boolean;
    directReceipt: boolean;
    separateReceiving: boolean;
    revision: number;
    inFlight: number;
    aborted: boolean;
  } | null>(null);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  function markBusy(key: string, active: boolean) {
    setBusyKeys((current) => {
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function flashSaved(key: string) {
    const existing = timersRef.current.get(key);
    if (existing) clearTimeout(existing);
    setSavedKeys((current) => new Set(current).add(key));
    const timer = setTimeout(() => {
      setSavedKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      timersRef.current.delete(key);
    }, 2500);
    timersRef.current.set(key, timer);
  }

  function enqueuePolicyWrite(
    key: string,
    patch: {
      directOrder?: boolean;
      directReceipt?: boolean;
      separateReceiving?: boolean;
      directOrderLimit?: number | null;
      overReceiptTolerancePct?: number;
      receivingContact?: string;
      receivingPhone?: string;
    },
    successMessage: string,
  ): Promise<void> {
    let entry = policyQueueRef.current;
    if (!entry || entry.inFlight === 0 || entry.aborted) {
      entry = {
        tail: Promise.resolve(),
        directOrder: policy?.directOrder ?? false,
        directReceipt: policy?.directReceipt ?? false,
        separateReceiving: policy?.separateReceiving ?? false,
        revision: policy?.revision ?? 0,
        inFlight: 0,
        aborted: false,
      };
      policyQueueRef.current = entry;
    }

    const nextDirectOrder = patch.directOrder ?? entry.directOrder;
    const nextDirectReceipt = patch.directReceipt ?? entry.directReceipt;
    const nextSeparateReceiving = patch.separateReceiving ?? entry.separateReceiving;
    entry.directOrder = nextDirectOrder;
    entry.directReceipt = nextDirectReceipt;
    entry.separateReceiving = nextSeparateReceiving;
    entry.inFlight += 1;

    setOptimisticPolicy({
      directOrder: nextDirectOrder,
      directReceipt: nextDirectReceipt,
      separateReceiving: nextSeparateReceiving,
    });
    markBusy(key, true);

    const activeEntry = entry;
    const run = activeEntry.tail.then(async () => {
      if (activeEntry.aborted) {
        markBusy(key, false);
        activeEntry.inFlight -= 1;
        return;
      }
      try {
        const nextRevision = await setBranchPolicy({
          branchId,
          directOrder: nextDirectOrder,
          directReceipt: nextDirectReceipt,
          ...(patch.separateReceiving !== undefined ? { separateReceiving: nextSeparateReceiving } : {}),
          ...(patch.directOrderLimit !== undefined ? { directOrderLimit: patch.directOrderLimit } : {}),
          ...(patch.overReceiptTolerancePct !== undefined
            ? { overReceiptTolerancePct: patch.overReceiptTolerancePct }
            : {}),
          ...(patch.receivingContact !== undefined ? { receivingContact: patch.receivingContact } : {}),
          ...(patch.receivingPhone !== undefined ? { receivingPhone: patch.receivingPhone } : {}),
          expectedRevision: activeEntry.revision,
        });
        activeEntry.revision = nextRevision;
        flashSaved(key);
        onSaved(successMessage);
      } catch (cause) {
        activeEntry.aborted = true;
        setError(parseStockError(cause, "Could not update branch policy. Review the refreshed settings and try again.").message);
      } finally {
        markBusy(key, false);
        activeEntry.inFlight -= 1;
        if (activeEntry.inFlight === 0) {
          if (policyQueueRef.current === activeEntry) policyQueueRef.current = null;
          setOptimisticPolicy({});
        }
      }
    });
    activeEntry.tail = run;
    return run;
  }

  async function togglePolicy(field: "directOrder" | "directReceipt" | "separateReceiving", next: boolean) {
    setError("");
    if (next && field !== "separateReceiving") {
      const confirmed = await confirm(
        field === "directOrder"
          ? {
              title: "Enable direct purchase orders?",
              description: `Buyers at ${branchName} will be able to create and issue orders without an approved purchase request.`,
              confirmLabel: "Enable direct orders",
            }
          : {
              title: "Enable direct supplier receipts?",
              description: `Receivers at ${branchName} will be able to post unplanned deliveries without a purchase order.`,
              confirmLabel: "Enable direct receipts",
            },
      );
      if (!confirmed) return;
    }

    await enqueuePolicyWrite(`policy-${field}`, { [field]: next }, "Branch stock policy updated.");
  }

  function toggleRole(row: GrantListRow, roleKey: keyof StockRoles) {
    setError("");
    const cellKey = `${row.staffGrantId}-${roleKey}`;
    let entry = staffQueuesRef.current.get(row.staffGrantId);
    if (!entry || entry.inFlight === 0 || entry.aborted) {
      const baseRoles: StockRoles = row.stockGrant?.roles ?? {
        requester: false,
        approver: false,
        buyer: false,
        receiver: false,
        lead: false,
      };
      entry = {
        tail: Promise.resolve(),
        roles: { ...baseRoles },
        revision: row.stockGrant?.revision ?? 0,
        inFlight: 0,
        aborted: false,
      };
      staffQueuesRef.current.set(row.staffGrantId, entry);
    }

    const nextRoles: StockRoles = { ...entry.roles, [roleKey]: !entry.roles[roleKey] };
    entry.roles = nextRoles;
    entry.inFlight += 1;
    setOptimisticRoles((curr) => ({ ...curr, [row.staffGrantId]: nextRoles }));
    markBusy(cellKey, true);

    const activeEntry = entry;
    const run = activeEntry.tail.then(async () => {
      if (activeEntry.aborted) {
        markBusy(cellKey, false);
        activeEntry.inFlight -= 1;
        return;
      }
      try {
        const nextRevision = await setGrant({
          branchId,
          staffGrantId: row.staffGrantId,
          roles: nextRoles,
          expectedRevision: activeEntry.revision,
        });
        activeEntry.revision = nextRevision;
        flashSaved(cellKey);
        onSaved(`Updated stock permissions for ${row.name || row.email}.`);
      } catch (cause) {
        activeEntry.aborted = true;
        setError(parseStockError(cause, "Could not update stock grant. Review the refreshed roles and try again.").message);
      } finally {
        markBusy(cellKey, false);
        activeEntry.inFlight -= 1;
        if (activeEntry.inFlight === 0) {
          if (staffQueuesRef.current.get(row.staffGrantId) === activeEntry) {
            staffQueuesRef.current.delete(row.staffGrantId);
          }
          setOptimisticRoles((curr) => {
            if (!(row.staffGrantId in curr)) return curr;
            const copy = { ...curr };
            delete copy[row.staffGrantId];
            return copy;
          });
        }
      }
    });
    activeEntry.tail = run;
  }

  function renderSaveBadge(key: string) {
    if (busyKeys.has(key)) {
      return <Spinner label="Saving" className="size-3.5 shrink-0 text-muted-foreground" />;
    }
    if (savedKeys.has(key)) {
      return (
        <span
          role="status"
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
        >
          <Check aria-hidden className="size-3.5 shrink-0" />
          Saved
        </span>
      );
    }
    return null;
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
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-5 sm:px-6">
          {error ? (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          ) : null}

          <section aria-label="Branch policies" className="grid content-start gap-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SlidersHorizontal aria-hidden className="size-4" />
              Branch purchasing policies
            </h3>
            <div className="grid gap-2.5 rounded-lg border border-border p-3.5">
              {(
                [
                  {
                    field: "directOrder",
                    checked: optimisticPolicy.directOrder ?? policy?.directOrder ?? false,
                    title: "Allow direct purchase orders",
                    description: "Buyers can create and issue orders without an approved purchase request.",
                  },
                  {
                    field: "directReceipt",
                    checked: optimisticPolicy.directReceipt ?? policy?.directReceipt ?? false,
                    title: "Allow direct supplier receipts without PO",
                    description: "Receivers can post unplanned supplier deliveries with a reason after checking open orders.",
                  },
                  {
                    field: "separateReceiving",
                    checked: optimisticPolicy.separateReceiving ?? policy?.separateReceiving ?? false,
                    title: "Separate ordering and receiving",
                    description: "The person who issued an order's current revision can't receive it. When off, such receipts post and are flagged in history.",
                  },
                ] as const
              ).map((item) => {
                const key = `policy-${item.field}`;
                const busy = policy === undefined || busyKeys.has(key);
                return (
                  <label key={item.field} className="flex min-h-11 items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={busy}
                      onChange={(event) => void togglePolicy(item.field, event.target.checked)}
                      className="mt-1 size-4 shrink-0 accent-foreground pointer-coarse:size-5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="font-medium text-foreground">{item.title}</strong>
                        {renderSaveBadge(key)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </label>
                );
              })}
              <PurchasingPolicyFields
                key={policy?.revision ?? 0}
                policy={policy ?? null}
                disabled={policy === undefined || busyKeys.has("policy-purchasing")}
                badge={renderSaveBadge("policy-purchasing")}
                onSave={async (values) => {
                  setError("");
                  await enqueuePolicyWrite("policy-purchasing", values, "Branch purchasing policy updated.");
                }}
              />
            </div>
          </section>

          <section aria-label="Staff stock grants" className="grid content-start gap-2.5">
            <h3 className="text-sm font-semibold text-foreground">Staff grants for {branchName}</h3>
            <SearchBox
              label="Find staff by name or email"
              placeholder="Search by name or email…"
              value={search}
              onChange={setSearch}
              maxLength={254}
            />
            {status === "LoadingFirstPage" || (grants.length === 0 && (status === "LoadingMore" || shouldAutoAdvance)) ? (
              <SkeletonRows
                label={grants.length === 0 && status !== "LoadingFirstPage" ? "Searching more staff" : "Loading staff grants"}
                rows={4}
              />
            ) : emptyContinuationPaused ? (
              <EmptyState
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAutoStep({ key: queryKey, count: 0 });
                      loadMore(STOCK_PAGE_SIZE);
                    }}
                  >
                    Search more staff
                  </Button>
                }
              >
                {searchTerm
                  ? `No matches for “${searchTerm}” in the scanned staff batch yet. More staff records remain.`
                  : "No eligible staff found in the scanned batch yet. More staff records remain."}
              </EmptyState>
            ) : grants.length === 0 ? (
              <EmptyState>
                {searchTerm
                  ? `No eligible staff match “${searchTerm}”.`
                  : "No eligible staff members assigned to this branch."}
              </EmptyState>
            ) : (
              <>
                {/* Desktop / tablet staff × role matrix (S22) */}
                <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2.5">Staff</th>
                        {ROLE_META.map((role) => (
                          <th key={role.key} scope="col" className="px-2 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap">
                              <span>{role.shortLabel}</span>
                              <InfoTip label={`About ${role.label}`}>{role.description}</InfoTip>
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {grants.map((row) => {
                        const roles = optimisticRoles[row.staffGrantId] ?? row.stockGrant?.roles ?? {
                          requester: false,
                          approver: false,
                          buyer: false,
                          receiver: false,
                          lead: false,
                        };
                        return (
                          <tr key={row.staffGrantId}>
                            <td className="max-w-[14rem] px-3 py-2 align-middle">
                              <span
                                className="block truncate font-medium text-foreground"
                                title={row.name ? `${row.name} (${row.email})` : row.email}
                              >
                                {row.name || row.email}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground" title={row.email}>
                                {row.name ? `${row.email} · ` : ""}
                                <span className="capitalize">{row.role}</span>
                              </span>
                            </td>
                            {ROLE_META.map(({ key, label }) => {
                              const cellKey = `${row.staffGrantId}-${key}`;
                              const busy = busyKeys.has(cellKey);
                              const saved = savedKeys.has(cellKey);
                              return (
                                <td key={key} className="px-2 py-1.5 text-center align-middle">
                                  <div className="inline-flex flex-col items-center justify-center gap-0.5">
                                    <label className="inline-flex size-9 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-ring pointer-coarse:size-11">
                                      <input
                                        type="checkbox"
                                        aria-label={`${label} for ${row.email}`}
                                        checked={roles[key]}
                                        disabled={busy}
                                        onChange={() => void toggleRole(row, key)}
                                        className="size-4 cursor-pointer accent-foreground pointer-coarse:size-5"
                                      />
                                    </label>
                                    {busy ? (
                                      <Spinner label={`Saving ${label}`} className="size-3 text-muted-foreground" />
                                    ) : saved ? (
                                      <span
                                        role="status"
                                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                                      >
                                        <Check aria-hidden className="size-3" />
                                        Saved
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards with 44 px switches (S22) */}
                <ul className="grid gap-3 sm:hidden">
                  {grants.map((row) => {
                    const roles = optimisticRoles[row.staffGrantId] ?? row.stockGrant?.roles ?? {
                      requester: false,
                      approver: false,
                      buyer: false,
                      receiver: false,
                      lead: false,
                    };
                    return (
                      <li key={row.staffGrantId} className="grid gap-2 rounded-lg border border-border p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {row.name || row.email}
                            </span>
                            {row.name ? (
                              <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-xs capitalize text-muted-foreground">{row.role}</span>
                        </div>
                        <div role="group" aria-label={`Stock roles for ${row.email}`} className="divide-y divide-border">
                          {ROLE_META.map(({ key, label, description }) => {
                            const cellKey = `${row.staffGrantId}-${key}`;
                            const busy = busyKeys.has(cellKey);
                            const checked = roles[key];
                            return (
                              <div key={key} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                                <div className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                                    <span>{label}</span>
                                    {renderSaveBadge(cellKey)}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">{description}</span>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={checked}
                                  aria-label={`${label} for ${row.email}`}
                                  disabled={busy}
                                  onClick={() => void toggleRole(row, key)}
                                  className={cn(
                                    "relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                                  )}
                                >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors",
                                      checked
                                        ? "border-foreground bg-foreground justify-end"
                                        : "border-border bg-muted justify-start",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "size-5 rounded-full shadow-sm transition-transform",
                                        checked ? "bg-background" : "bg-card",
                                      )}
                                    />
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {grants.length > 0 && status === "CanLoadMore" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
                Load more staff
              </Button>
            ) : grants.length > 0 && status === "LoadingMore" ? (
              <Button type="button" variant="outline" size="sm" disabled>
                <Spinner label="Loading more staff" className="size-3.5 text-current" />
                Loading more staff…
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

type PolicyRow = NonNullable<FunctionReturnType<typeof api.commerce.stock.branchPolicy>>;

/** Direct order limit (฿; empty = none), over-delivery tolerance (%) and the receiving contact printed on supplier copies. */
function PurchasingPolicyFields({
  policy, disabled, badge, onSave,
}: {
  policy: PolicyRow | null;
  disabled: boolean;
  badge: ReactNode;
  onSave: (values: { directOrderLimit: number | null; overReceiptTolerancePct: number; receivingContact: string; receivingPhone: string }) => Promise<void>;
}) {
  const start = {
    tolerance: policy?.overReceiptTolerancePct ? String(policy.overReceiptTolerancePct) : "",
    limit: policy?.directOrderLimit ? String(policy.directOrderLimit / 100) : "",
    contact: policy?.receivingContact ?? "",
    phone: policy?.receivingPhone ?? "",
  };
  const [limit, setLimit] = useState(start.limit);
  const [contact, setContact] = useState(start.contact);
  const [phone, setPhone] = useState(start.phone);
  const [tolerance, setTolerance] = useState(start.tolerance);
  const [fieldError, setFieldError] = useState("");
  const [toleranceError, setToleranceError] = useState("");
  const dirty = limit.trim() !== start.limit || contact.trim() !== start.contact || phone.trim() !== start.phone ||
    tolerance.trim() !== start.tolerance;
  async function save() {
    setFieldError("");
    const parsed = parseOptionalSatang(limit);
    if (!parsed.ok) {
      setFieldError(parsed.error);
      return;
    }
    if (parsed.value !== undefined && parsed.value <= 0) {
      setFieldError("Enter a limit above ฿0, or leave it empty for no limit.");
      return;
    }
    setToleranceError("");
    const pct = tolerance.trim() === "" ? 0 : Number(tolerance.trim());
    if (!Number.isSafeInteger(pct) || pct < 0 || pct > 25) {
      setToleranceError("Enter a whole percent from 0 to 25, or leave it empty for no tolerance.");
      return;
    }
    await onSave({ directOrderLimit: parsed.value ?? null, overReceiptTolerancePct: pct, receivingContact: contact, receivingPhone: phone });
  }
  return (
    <div className="grid gap-3 border-t border-border pt-3 text-sm">
      <div className="grid gap-1">
        <label htmlFor="policy-direct-limit" className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          Direct order limit (฿) {badge}
        </label>
        <Input id="policy-direct-limit" inputMode="decimal" value={limit} disabled={disabled} placeholder="No limit"
          aria-invalid={fieldError ? true : undefined} aria-describedby="policy-direct-limit-help"
          onChange={(event) => setLimit(event.target.value)} className="max-w-48" />
        <p id="policy-direct-limit-help" className="text-xs text-muted-foreground">
          Direct orders above this total wait for a different approver before they are issued.
        </p>
        {fieldError ? <p role="alert" className="text-xs font-medium text-destructive">{fieldError}</p> : null}
      </div>
      <div className="grid gap-1">
        <label htmlFor="policy-over-receipt-tolerance" className="font-medium text-foreground">Over-delivery tolerance (%)</label>
        <Input id="policy-over-receipt-tolerance" inputMode="numeric" value={tolerance} disabled={disabled} placeholder="Off"
          aria-invalid={toleranceError ? true : undefined} aria-describedby="policy-over-receipt-tolerance-help"
          onChange={(event) => setTolerance(event.target.value)} className="max-w-32" />
        <p id="policy-over-receipt-tolerance-help" className="text-xs text-muted-foreground">
          Receivers may accept up to this share of a line&apos;s ordered quantity beyond what is due; the order records the over-delivery. Larger excess still goes to held goods.
        </p>
        {toleranceError ? <p role="alert" className="text-xs font-medium text-destructive">{toleranceError}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor="policy-receiving-contact" className="font-medium text-foreground">Receiving contact</label>
          <Input id="policy-receiving-contact" value={contact} maxLength={200} disabled={disabled} placeholder="e.g. Store room"
            onChange={(event) => setContact(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="policy-receiving-phone" className="font-medium text-foreground">Receiving phone</label>
          <Input id="policy-receiving-phone" value={phone} maxLength={200} disabled={disabled} inputMode="tel"
            onChange={(event) => setPhone(event.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Printed on supplier copies of purchase orders with the branch&apos;s legal name and address.</p>
      <div>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !dirty} onClick={() => void save()}>
          Save purchasing policy
        </Button>
      </div>
    </div>
  );
}
