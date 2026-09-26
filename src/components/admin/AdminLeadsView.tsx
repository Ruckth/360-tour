"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SOURCES = {
  tour_completion: "Tour completed",
  chat: "Chat",
  booking_abandonment: "Abandoned booking",
} as const;

type Source = keyof typeof SOURCES;
const PAGE_SIZE = 25;

export function AdminLeadsView() {
  const [source, setSource] = useState<Source | "all">("all");
  const { results, status, loadMore } = usePaginatedQuery(
    api.leads.list,
    source === "all" ? {} : { source },
    { initialNumItems: PAGE_SIZE },
  );
  const properties = useQuery(api.properties.adminList, {});
  const propertyNames = new Map(properties?.map((property) => [property._id as string, property.name]));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <p className="flex-1 text-sm text-muted-foreground">
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
        </div>

        {status === "LoadingFirstPage" ? (
          <Loader2 className="mx-auto my-16 size-5 animate-spin text-gold" />
        ) : results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No leads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Villa</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {results.map((lead) => (
                  <tr key={lead._id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <a href={`mailto:${lead.email}`} className="hover:underline">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {status === "CanLoadMore" || status === "LoadingMore" ? (
          <div className="border-t border-border p-3 text-center">
            <Button size="sm" variant="outline" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
              {status === "LoadingMore" ? <Loader2 className="size-4 animate-spin" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
