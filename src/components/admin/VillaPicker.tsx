"use client";

import { House } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EntityPicker, type PickerOption } from "@/components/ui/entity-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AdminProperty } from "./admin-bookings-shared";
import { formatMoney } from "./labels";

function villaSummary(property: AdminProperty) {
  return `Up to ${property.maxGuests} guests · ${formatMoney(property.pricePerNight, property.currency)} / night`;
}

function VillaThumb({
  property,
  className,
}: {
  property: AdminProperty;
  className: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return property.imageUrl && failedUrl !== property.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={property.imageUrl}
      alt=""
      onError={() => setFailedUrl(property.imageUrl)}
      className={cn("shrink-0 rounded-lg bg-muted object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
        className,
      )}
    >
      <House className="size-4" />
    </span>
  );
}

/** Value stays a property ID; callers translate to a slug only where their form needs it. */
export function VillaPicker({
  id,
  labelId,
  properties,
  value,
  onChange,
  disabled,
  includeAll = false,
  compact = false,
  className,
}: {
  id?: string;
  labelId?: string;
  properties: AdminProperty[];
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  includeAll?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [viewing, setViewing] = useState<AdminProperty | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const items: PickerOption<string>[] = [...properties]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((property) => ({
        value: property._id,
        label: property.name,
        description: villaSummary(property),
        renderThumbnail: (size: string) => (
          <VillaThumb property={property} className={size} />
        ),
        onPreview: property.imageUrl ? () => setViewing(property) : undefined,
      }));
    return includeAll
      ? [{ value: "all", label: "All villas" }, ...items]
      : items;
  }, [properties, includeAll]);

  return (
    <>
      <EntityPicker
        id={id}
        labelId={labelId}
        label="Villa"
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        compact={compact}
        className={className}
        placeholder="Choose a villa"
        searchLabel="Search villas"
        emptyLabel="No villas yet. Add one under Villas."
        noResultsLabel="No villas match."
        interactionLocked={viewing !== null}
        searchRef={search}
      />
      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            search.current?.focus();
          }}
        >
          <DialogTitle className="pr-8">{viewing?.name}</DialogTitle>
          <DialogDescription>
            {viewing ? villaSummary(viewing) : ""}
          </DialogDescription>
          {viewing?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={viewing.imageUrl}
              alt={`Photo of ${viewing.name}`}
              className="max-h-[65dvh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
