"use client";

import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { format } from "date-fns";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function downloadCsv(filename: string, rows: string[][]) {
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
  const { results, status, loadMore } = usePaginatedQuery(
    api.leads.list,
    source === "all" ? {} : { source },
    { initialNumItems: PAGE_SIZE },
  );
  const removeLead = useMutation(api.leads.remove);
  const properties = useQuery(api.properties.adminList, {});
  const propertyNames = new Map(properties?.map((property) => [property._id as string, property.name]));

  async function exportCsv() {
    setPending("export");
    setError(null);
    setNotice(null);
    try {
      const { rows, truncated } = await convex.query(api.leads.exportRows, source === "all" ? {} : { source });
      downloadCsv(`leads-${source}-${format(Date.now(), "yyyy-MM-dd")}.csv`, [
        ["email", "source", "villa", "created"],
        ...rows.map((lead) => [
          lead.email,
          SOURCES[lead.source],
          lead.propertyId ? (propertyNames.get(lead.propertyId) ?? "") : "",
          new Date(lead.createdAt).toISOString(),
        ]),
      ]);
      if (truncated) setNotice(`Exported the newest ${rows.length.toLocaleString()} leads only.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export leads.");
    } finally {
      setPending(null);
    }
  }

  async function deleteLead(lead: Doc<"leads">) {
    const confirmed = await confirm({
      title: "Delete this lead?",
      description: `${lead.email} (${SOURCES[lead.source]}) is removed for good.`,
      confirmLabel: "Delete lead",
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
          <p className="min-w-60 flex-1 text-sm text-muted-foreground">
            Guests who left an email after a tour, in chat, or on an unfinished booking. Newest first.
          </p>
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
        {notice ? (
          <p role="status" className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}

        {status === "LoadingFirstPage" ? (
          <SkeletonRows label="Loading leads" />
        ) : results.length === 0 ? (
          source === "all" ? (
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
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
                    <td className="px-4 py-3 font-medium text-foreground">
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
                    <td className="px-4 py-3 text-muted-foreground">
                      {lead.propertyId ? (propertyNames.get(lead.propertyId) ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{format(lead.createdAt, "d MMM yyyy, HH:mm")}</td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={pending === lead._id}
                        aria-label={`Delete lead ${lead.email}`}
                        onClick={() => void deleteLead(lead)}
                      >
                        {pending === lead._id ? (
                          <Spinner label="Deleting" />
                        ) : (
                          <Trash2 aria-hidden="true" className="size-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
