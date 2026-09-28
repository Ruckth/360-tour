"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { slugify } from "convex/lib/slug";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { formatMoney } from "./labels";
import { Field, PROPERTY_STATUS, SaveStatus, Thumb, useSaver, type PropertyStatus } from "./property-form";

export function propertyPath(propertyId: string) {
  return `/admin/properties/${propertyId}`;
}

export function AdminPropertiesView() {
  const properties = useQuery(api.properties.adminList, {});
  const [status, setStatus] = useState<PropertyStatus | "all">("all");
  const [creating, setCreating] = useState(false);
  const shown = properties?.filter((property) => status === "all" || property.status === status);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <p className="min-w-60 flex-1 text-sm text-muted-foreground">
            Villas used by the AI concierge, the chat channels and the booking flow. Only active villas are offered to guests.
          </p>
          <Select value={status} onValueChange={(value) => setStatus(value as PropertyStatus | "all")}>
            <SelectTrigger className="h-9 w-36 rounded-lg" aria-label="Villa status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All villas</SelectItem>
              {Object.entries(PROPERTY_STATUS).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            New villa
          </Button>
        </div>
        {!shown ? (
          <ul role="status" aria-label="Loading villas" className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-10" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((property) => (
              <li key={property._id}>
                <Link
                  href={propertyPath(property._id)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {/* Only the picture fades for archived villas: faded text would fail contrast. */}
                  <Thumb src={property.images[0]} className={cn("size-10", property.status === "archived" && "opacity-50 grayscale")} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                      {property.name}
                      {property.status !== "active" ? <StatusBadge {...PROPERTY_STATUS[property.status]} /> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatMoney(property.pricePerNight, property.currency)} / night · {property.maxGuests} guests ·{" "}
                      {property.bedrooms} bedrooms · /{property.slug}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="grid justify-items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground">
                {status === "all" ? (
                  <>
                    No villas yet. Create the first one.
                    <Button size="sm" onClick={() => setCreating(true)}>
                      <Plus aria-hidden className="size-4" />
                      New villa
                    </Button>
                  </>
                ) : (
                  `No ${PROPERTY_STATUS[status].label.toLowerCase()} villas.`
                )}
              </li>
            ) : null}
          </ul>
        )}
      </section>
      <NewVillaDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewVillaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useMutation(api.adminProperties.create);
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const save = useSaver();

  async function submit(event: FormEvent) {
    event.preventDefault();
    let propertyId = "";
    const ok = await save.run(async () => {
      propertyId = await create({ name, slug: slug.trim() || undefined });
    });
    if (ok) router.push(propertyPath(propertyId));
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New villa</DialogTitle>
          <DialogDescription>It starts as a draft, hidden from guests until you publish it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="new-villa-name">
            <Input id="new-villa-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </Field>
          <Field label="Web address (optional)" htmlFor="new-villa-slug">
            <Input
              id="new-villa-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={slugify(name) || "villa"}
            />
            <p className="text-xs text-muted-foreground">
              /rooms/{slug.trim() || slugify(name) || "villa"}. Left empty, it&apos;s made from the name (with -2, -3… if taken).
            </p>
          </Field>
          <DialogFooter className="items-center">
            <SaveStatus save={save} />
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.saving}>
              {save.saving ? <Spinner className="text-current" /> : null}
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
