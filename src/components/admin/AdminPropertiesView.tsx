"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ChevronLeft, Loader2, Pencil, PlusIcon, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorText, money } from "@/lib/staff-bookings";
import { OtaRatesDialog } from "./OtaRatesDialog";
import { cn } from "@/lib/utils";

type Property = Doc<"properties">;
type Status = Property["status"];

const STATUS_LABELS: Record<Status, string> = { active: "Active", draft: "Draft", archived: "Archived" };
const TEXTAREA =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

export function AdminPropertiesView() {
  const properties = useQuery(api.properties.adminList, {});
  const [selectedId, setSelectedId] = useState<Id<"properties"> | null>(null);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:px-6">
      {!properties ? (
        <Loader2 className="mx-auto my-16 size-5 animate-spin text-gold" />
      ) : selectedId ? (
        <PropertyEditor key={selectedId} propertyId={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <section className="border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Villa details and room names used by the AI concierge, the chat channels and the booking
            flow, plus the OTA rates guests see. Villa pages still show the built-in content. Only active villas are offered in chat.
          </p>
          <ul className="divide-y divide-border">
            {properties.map((property) => (
              <li key={property._id} className={cn("flex items-center gap-3 px-4 py-3", property.status !== "active" && "opacity-60")}>
                {property.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail from arbitrary URLs
                  <img src={property.images[0]} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="size-10 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                    {property.name}
                    {property.status !== "active" ? <Badge variant="outline">{STATUS_LABELS[property.status]}</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {money(property.pricePerNight, property.currency)} / night · {property.maxGuests} guests ·{" "}
                    {property.bedrooms} bedrooms · /{property.slug}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedId(property._id)} aria-label={`Edit ${property.name}`}>
                  <Pencil aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
            {properties.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">No villas yet. Run the seed first.</li>
            ) : null}
          </ul>
        </section>
      )}
    </div>
  );
}

function PropertyEditor({ propertyId, onBack }: { propertyId: Id<"properties">; onBack: () => void }) {
  const data = useQuery(api.properties.adminGet, { propertyId });

  return (
    <>
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ChevronLeft aria-hidden className="size-4" />
        All villas
      </Button>
      {data === undefined ? (
        <Loader2 className="mx-auto my-16 size-5 animate-spin text-gold" />
      ) : data === null ? (
        <p className="text-sm text-muted-foreground">This villa no longer exists.</p>
      ) : (
        <>
          <DetailsForm property={data.property} />
          <Section title="Rooms" description="Names shown in the virtual tour. Hotspots are edited with the tour tooling.">
            {data.rooms.length ? (
              <div className="grid gap-3">
                {data.rooms.map((room) => (
                  <RoomForm key={room._id} room={room} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No rooms for this villa.</p>
            )}
          </Section>
          <OtaRatesSection property={data.property} />
        </>
      )}
    </>
  );
}

function DetailsForm({ property }: { property: Property }) {
  const update = useMutation(api.properties.update);
  const [status, setStatus] = useState<Status>(property.status);
  const save = useSaver();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const lines = (name: string) => text(name).split("\n").map((line) => line.trim()).filter(Boolean);
    void save.run(() =>
      update({
        propertyId: property._id,
        name: text("name"),
        tagline: text("tagline"),
        description: text("description"),
        pricePerNight: Number(text("pricePerNight")),
        currency: text("currency"),
        directDiscountPercent: Number(text("directDiscountPercent")),
        maxGuests: Number(text("maxGuests")),
        bedrooms: Number(text("bedrooms")),
        bathrooms: Number(text("bathrooms")),
        area: Number(text("area")),
        amenities: lines("amenities"),
        images: lines("images"),
        status,
      }),
    );
  }

  return (
    <Section title={property.name} description={`/${property.slug}`}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label="Name" htmlFor="pr-name">
            <Input id="pr-name" name="name" defaultValue={property.name} required />
          </Field>
          <Field label="Status" htmlFor="pr-status">
            <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
              <SelectTrigger id="pr-status" className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Tagline" htmlFor="pr-tagline">
          <Input id="pr-tagline" name="tagline" defaultValue={property.tagline} />
        </Field>
        <Field label="Description" htmlFor="pr-description">
          <textarea id="pr-description" name="description" defaultValue={property.description} className={TEXTAREA} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Price per night" htmlFor="pr-price">
            <Input id="pr-price" name="pricePerNight" type="number" min={0} defaultValue={property.pricePerNight} required />
          </Field>
          <Field label="Currency" htmlFor="pr-currency">
            <Input id="pr-currency" name="currency" maxLength={3} defaultValue={property.currency} required />
          </Field>
          <Field label="Direct discount (%)" htmlFor="pr-discount">
            <Input id="pr-discount" name="directDiscountPercent" type="number" min={0} max={100} defaultValue={property.directDiscountPercent} required />
          </Field>
          <Field label="Max guests" htmlFor="pr-guests">
            <Input id="pr-guests" name="maxGuests" type="number" min={1} defaultValue={property.maxGuests} required />
          </Field>
          <Field label="Bedrooms" htmlFor="pr-bedrooms">
            <Input id="pr-bedrooms" name="bedrooms" type="number" min={0} defaultValue={property.bedrooms} required />
          </Field>
          <Field label="Bathrooms" htmlFor="pr-bathrooms">
            <Input id="pr-bathrooms" name="bathrooms" type="number" min={0} step={0.5} defaultValue={property.bathrooms} required />
          </Field>
          <Field label="Area (m²)" htmlFor="pr-area">
            <Input id="pr-area" name="area" type="number" min={0} defaultValue={property.area} required />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amenities (one per line)" htmlFor="pr-amenities">
            <textarea id="pr-amenities" name="amenities" defaultValue={property.amenities.join("\n")} className={cn(TEXTAREA, "min-h-40")} />
          </Field>
          <Field label="Image URLs (one per line, first is the cover)" htmlFor="pr-images">
            <textarea id="pr-images" name="images" defaultValue={property.images.join("\n")} className={cn(TEXTAREA, "min-h-40")} />
          </Field>
        </div>
        <SaveBar save={save} />
      </form>
    </Section>
  );
}

function RoomForm({ room }: { room: Doc<"rooms"> }) {
  const updateRoom = useMutation(api.properties.updateRoom);
  const save = useSaver();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save.run(() =>
      updateRoom({
        roomId: room._id,
        name: String(form.get("name") ?? ""),
        imagePath: String(form.get("imagePath") ?? "").trim(),
      }),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
      <Field label={`Room name · ${room.slug}`} htmlFor={`room-${room._id}-name`}>
        <Input id={`room-${room._id}-name`} name="name" defaultValue={room.name} required />
      </Field>
      <Field label="Panorama image" htmlFor={`room-${room._id}-image`}>
        <Input id={`room-${room._id}-image`} name="imagePath" defaultValue={room.imagePath} required />
      </Field>
      <SaveBar save={save} compact />
    </form>
  );
}

function OtaRatesSection({ property }: { property: Property }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="OTA rates" description="Nightly prices on Booking.com, Agoda, Airbnb and Expedia, shown to guests next to the direct price.">
      <Button type="button" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        Edit OTA rates
      </Button>
      <OtaRatesDialog open={open} onClose={() => setOpen(false)} properties={[property]} />
    </Section>
  );
}

function NumberInput({ label, value, max, onChange }: { label: string; value: string; max?: number; onChange: (value: string) => void }) {
  return (
    <Input aria-label={label} title={label} type="number" min={0} max={max} value={value} onChange={(e) => onChange(e.target.value)} required />
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

type Saver = ReturnType<typeof useSaver>;

function useSaver() {
  const [state, setState] = useState({ saving: false, error: "", saved: false });
  async function run(action: () => Promise<unknown>) {
    setState({ saving: true, error: "", saved: false });
    try {
      await action();
      setState({ saving: false, error: "", saved: true });
    } catch (err) {
      setState({ saving: false, error: errorText(err, "Could not save."), saved: false });
    }
  }
  return { ...state, run };
}

function SaveBar({ save, compact, children }: { save: Saver; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-end gap-3", !compact && "border-t border-border pt-4")}>
      {children}
      {save.error ? <p className="text-sm text-destructive">{save.error}</p> : null}
      {save.saved ? <p className="text-sm text-muted-foreground">Saved</p> : null}
      <Button type="submit" size={compact ? "sm" : "default"} disabled={save.saving} className={cn(compact && "h-10")}>
        {save.saving ? <Loader2 className="size-4 animate-spin" /> : null}
        Save
      </Button>
    </div>
  );
}
