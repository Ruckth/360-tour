"use client";

import { staffDateTime } from "@/lib/staff-time";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { format } from "date-fns";
import { Download, Search, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoreMenu } from "@/components/ui/more-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toCsv } from "@/lib/admin/csv";

const SOURCES = {
  tour_completion: "Tour completed",
  chat: "Chat",
  booking_abandonment: "Abandoned booking",
} as const;

type Source = keyof typeof SOURCES;
const PAGE_SIZE = 25;

/** Downloads `rows` as `<name>-<today>.csv`. */
function downloadCsv(name: string, rows: string[][]) {
  const filename = `${name}-${format(Date.now(), "yyyy-MM-dd")}.csv`;
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AdminLeadsView() {
  const convex = useConvex();
  const confirm = useConfirm();
  const [source, setSource] = useState<Source | "all">("all");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Exact email lookup across every page; list and CSV share the same server filters.
  const [emailInput, setEmailInput] = useState("");
  const [email, setEmail] = useState("");
  const filters = { ...(source === "all" ? {} : { source }), ...(email ? { email } : {}) };
  const { results, status, loadMore } = usePaginatedQuery(api.messaging.leads.list, filters, { initialNumItems: PAGE_SIZE });
  const removeLead = useMutation(api.messaging.leads.remove);
  const properties = useQuery(api.catalog.properties.adminList, {});
  const propertyNames = new Map(properties?.map((property) => [property._id as string, property.name]));
  const villaName = (lead: Doc<"leads">) => (lead.propertyId ? propertyNames.get(lead.propertyId) : undefined);

  async function exportCsv() {
    setPending("export");
    setError(null);
    setNotice(null);
    try {
      const { rows, truncated, limit } = await convex.query(api.messaging.leads.exportRows, filters);
      downloadCsv(`leads-${source}`, [
        ["email", "source", "villa", "created"],
        ...rows.map((lead) => [
          lead.email,
          SOURCES[lead.source],
          lead.propertyId ? (propertyNames.get(lead.propertyId) ?? "") : "",
          new Date(lead.createdAt).toISOString(),
        ]),
      ]);
      setNotice(
        truncated
          ? `Exported the newest ${rows.length.toLocaleString()} matching leads. The export stops at ${limit.toLocaleString()}; filter by source or email to export the rest.`
          : `Exported ${rows.length.toLocaleString()} matching ${rows.length === 1 ? "lead" : "leads"}.`,
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export leads.");
    } finally {
      setPending(null);
    }
  }

  function findEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmail(emailInput.trim().toLowerCase());
  }
  function clearEmail() {
    setEmailInput("");
    setEmail("");
  }

  async function deleteLead(lead: Doc<"leads">) {
    const confirmed = await confirm({
      title: "Delete this lead permanently?",
      description: `${lead.email} (${SOURCES[lead.source]}) is removed for good. This can't be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
    });
    if (!confirmed) return;
    setPending(lead._id);
    setError(null);
    try {
      await removeLead({ leadId: lead._id });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete lead.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-60 flex-1 text-sm text-muted-foreground">
            <p>Guests who left an email after a tour, in chat, or on an unfinished booking. Newest first.</p>
            {/* Leads are company data: villas carry no branch, so the branch switch doesn't narrow them. */}
            <p data-testid="leads-scope" className="mt-0.5 text-xs">
              All branches and villas, including leads with no villa. Export CSV includes every match, up to 5,000.
            </p>
          </div>
          <form role="search" aria-label="Find leads by email" onSubmit={findEmail} className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                placeholder="guest@example.com"
                aria-label="Email address"
                className="h-9 w-full pl-9 sm:w-56"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!emailInput.trim()}>
              Find
            </Button>
          </form>
          <Select value={source} onValueChange={(value) => setSource(value as Source | "all")}>
            <SelectTrigger className="h-9 w-48 rounded-lg" aria-label="Lead source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {Object.entries(SOURCES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DisabledReason
            reason={
              properties === undefined
                ? "Loading villas"
                : status !== "LoadingFirstPage" && results.length === 0 && "No leads to export"
            }
          >
            <Button
              size="sm"
              variant="outline"
              disabled={pending === "export" || results.length === 0 || properties === undefined}
              onClick={() => void exportCsv()}
            >
              {pending === "export" ? (
                <Spinner label="Exporting" className="text-current" />
              ) : (
                <Download aria-hidden="true" className="size-4" />
              )}
              Export CSV
            </Button>
          </DisabledReason>
        </div>
        {error ? (
          <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        {email ? (
          <p role="status" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm">
            <span className="min-w-0 break-all">Leads for {email}</span>
            <Button type="button" size="sm" variant="ghost" onClick={clearEmail}>
              <X aria-hidden="true" className="size-4" />
              Clear
            </Button>
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}

        {status === "LoadingFirstPage" ? (
          <SkeletonRows label="Loading leads" />
        ) : results.length === 0 ? (
          email ? (
            <EmptyState action={<Button type="button" size="sm" onClick={clearEmail}>Clear email</Button>}>
              No leads for {email}{source === "all" ? "" : ` from "${SOURCES[source]}"`}.
            </EmptyState>
          ) : source === "all" ? (
            <EmptyState>
              No leads yet. Guests appear here when they leave an email after a tour, in chat, or on an unfinished booking.
            </EmptyState>
          ) : (
            <EmptyState
              action={
                <Button type="button" size="sm" onClick={() => setSource("all")}>
                  Show all sources
                </Button>
              }
            >
              No leads from &quot;{SOURCES[source]}&quot; yet.
            </EmptyState>
          )
        ) : (
          <>
            {/* Phones: one two-line card per lead, so every field and the action fit without panning. */}
            <ul className="divide-y divide-border sm:hidden" aria-label="Leads">
              {results.map((lead) => (
                <li key={lead._id} className="flex min-w-0 items-start gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <a href={`mailto:${lead.email}`} className="break-all text-sm font-medium text-foreground hover:underline">
                      {lead.email}
                    </a>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[SOURCES[lead.source], villaName(lead), staffDateTime(lead.createdAt)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <LeadActions lead={lead} pending={pending === lead._id} onDelete={() => void deleteLead(lead)} />
                </li>
              ))}
            </ul>
            <table className="hidden w-full text-left text-sm sm:table">
              <thead className="admin-eyebrow border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Villa</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((lead) => (
                  <tr key={lead._id} className="border-b border-border last:border-b-0">
                    <td className="break-all px-4 py-3 font-medium text-foreground">
                      <a
                        href={`mailto:${lead.email}`}
                        className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {lead.email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{SOURCES[lead.source]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{villaName(lead) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{staffDateTime(lead.createdAt)}</td>
                    <td className="px-2 py-2 text-right">
                      <LeadActions lead={lead} pending={pending === lead._id} onDelete={() => void deleteLead(lead)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {status === "CanLoadMore" || status === "LoadingMore" ? (
          <div className="border-t border-border p-3 text-center">
            <Button size="sm" variant="outline" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
              {status === "LoadingMore" ? <Spinner label="Loading more leads" className="text-current" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Permanent deletion sits in the row's ⋯ menu, labelled as such, and still asks to confirm. */
function LeadActions({ lead, pending, onDelete }: { lead: Doc<"leads">; pending: boolean; onDelete: () => void }) {
  if (pending) return <Spinner label="Deleting" />;
  return <MoreMenu label={`Actions for lead ${lead.email}`} items={[{ label: "Delete permanently", destructive: true, onSelect: onDelete }]} />;
}
