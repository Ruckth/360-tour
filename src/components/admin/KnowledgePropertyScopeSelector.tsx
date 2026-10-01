"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, RemovableBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/admin/DisabledReason";
import type { AdminKnowledgePropertyScope } from "@/components/admin/admin-knowledge-types";
import { cn } from "@/lib/utils";

function normalizePropertySlugInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const OPTION =
  "flex items-center justify-between gap-3 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function SelectedMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gold-text">
      <Check aria-hidden="true" className="h-3.5 w-3.5" />
      Selected
    </span>
  );
}

export function KnowledgePropertyScopeSelector({
  disabled = false,
  labelledBy,
  onChange,
  onCreate,
  onDelete,
  pendingAction,
  scopes,
  selectedSlugs,
}: {
  disabled?: boolean;
  /** Id of the visible label, so the group and its button are named. */
  labelledBy?: string;
  onChange: (slugs: string[]) => void;
  onCreate: (slug: string) => void;
  onDelete: (slug: string) => void;
  pendingAction: string;
  scopes: AdminKnowledgePropertyScope[];
  selectedSlugs: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizePropertySlugInput(query);
  const scopeBySlug = new Map(scopes.map((scope) => [scope.slug, scope]));
  const selectedScopes = selectedSlugs.map(
    (slug) =>
      scopeBySlug.get(slug) ?? {
        slug,
        normalizedSlug: normalizePropertySlugInput(slug),
        label: slug,
        source: "custom" as const,
        canDelete: true,
      },
  );
  const filteredScopes = scopes.filter((scope) => {
    const haystack = `${scope.slug} ${scope.label}`.toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  });
  const canCreate =
    Boolean(normalizedQuery) &&
    !scopes.some((scope) => scope.normalizedSlug === normalizedQuery || scope.slug === normalizedQuery);

  function toggleSlug(slug: string) {
    onChange(
      selectedSlugs.includes(slug)
        ? selectedSlugs.filter((item) => item !== slug)
        : [...selectedSlugs, slug],
    );
  }

  function createScope() {
    if (!canCreate) return;
    onCreate(normalizedQuery);
    setQuery("");
  }

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={cn("rounded-lg border border-input bg-background p-2", disabled && "opacity-60")}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {selectedScopes.length === 0 ? (
          <Badge variant="secondary" className="rounded-full">
            All properties
          </Badge>
        ) : (
          selectedScopes.map((scope) => (
            <RemovableBadge
              key={scope.slug}
              removeLabel={`Remove ${scope.label}`}
              disabled={disabled}
              onRemove={() => toggleSlug(scope.slug)}
            >
              {scope.label}
            </RemovableBadge>
          ))
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled} className="ml-auto">
              <Plus aria-hidden="true" className="h-4 w-4" />
              Properties
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-3">
            <div className="space-y-3">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createScope();
                  }
                }}
                placeholder="Search or add a slug"
                aria-label="Search properties or add a slug"
              />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                <button
                  type="button"
                  aria-pressed={selectedSlugs.length === 0}
                  className={cn(
                    OPTION,
                    "w-full rounded-lg transition hover:bg-muted",
                    selectedSlugs.length === 0 && "bg-muted text-foreground",
                  )}
                  onClick={() => onChange([])}
                >
                  <span>All properties</span>
                  {selectedSlugs.length === 0 ? <SelectedMark /> : null}
                </button>
                {filteredScopes.map((scope) => {
                  const selected = selectedSlugs.includes(scope.slug);
                  const deleting = pendingAction === `delete-property-scope:${scope.slug}`;
                  return (
                    <div key={scope.slug} className="flex items-center gap-1 rounded-lg hover:bg-muted">
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={cn(OPTION, "min-w-0 flex-1 rounded-lg")}
                        onClick={() => toggleSlug(scope.slug)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{scope.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{scope.slug}</span>
                        </span>
                        {selected ? <SelectedMark /> : null}
                      </button>
                      {scope.source === "custom" ? (
                        <DisabledReason reason={!scope.canDelete && "Cannot delete while linked to an answer"}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!scope.canDelete || deleting}
                            aria-label={`Delete ${scope.label}`}
                            title={scope.canDelete ? `Delete ${scope.label}` : undefined}
                            onClick={() => onDelete(scope.slug)}
                            className="mr-1 h-8 w-8"
                          >
                            {deleting ? (
                              <Spinner label="Deleting" className="h-3.5 w-3.5" />
                            ) : (
                              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </DisabledReason>
                      ) : null}
                    </div>
                  );
                })}
                {filteredScopes.length === 0 && !canCreate ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">No properties found</div>
                ) : null}
              </div>
              {canCreate ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pendingAction === "create-property-scope"}
                  onClick={createScope}
                >
                  {pendingAction === "create-property-scope" ? (
                    <Spinner label="Adding" className="text-current" />
                  ) : (
                    <Plus aria-hidden="true" className="h-4 w-4" />
                  )}
                  Add {normalizedQuery}
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
