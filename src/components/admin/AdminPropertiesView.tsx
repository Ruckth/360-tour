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
import { cn } from "@/lib/utils";

type Property = Doc<"properties">;
type Pricing = Doc<"pricing">;
type Status = Property["status"];

const STATUS_LABELS: Record<Status, string> = { active: "Active", draft: "Draft", archived: "Archived" };
const TEXTAREA =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
// Rows hold raw input text so number fields can be cleared while typing; converted on submit.
type OtaRow = Record<keyof Pricing["otaPricing"][number], string>;
const EMPTY_OTA: OtaRow = {
  platform: "",
  displayName: "",
  nightlyRate: "",
  serviceFeePercent: "",
  cleaningFee: "",
  logo: "",
};

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
            Villa details, room names and price comparisons used by the AI concierge, the chat channels and the booking
            flow. Villa pages still show the built-in content. Only active villas are offered in chat.
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
          <PricingForm
            key={propertyId}
            propertyId={propertyId}
            pricing={data.pricing}
            currency={data.property.currency}
          />
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

function PricingForm({ propertyId, pricing, currency }: { propertyId: Id<"properties">; pricing: Pricing | null; currency: string }) {
  const savePricing = useMutation(api.properties.savePricing);
  const deletePricing = useMutation(api.properties.deletePricing);
  const [directRate, setDirectRate] = useState(pricing ? String(pricing.directRate) : "");
  const [otas, setOtas] = useState<OtaRow[]>(
    () =>
      pricing?.otaPricing.map((ota) => ({
        ...ota,
        nightlyRate: String(ota.nightlyRate),
        serviceFeePercent: String(ota.serviceFeePercent),
        cleaningFee: String(ota.cleaningFee),
      })) ?? [],
  );
  const [benefits, setBenefits] = useState(pricing?.directBenefits ?? []);
  const save = useSaver();

  const updateOta = (index: number, patch: Partial<OtaRow>) =>
    setOtas((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const updateBenefit = (index: number, patch: Partial<Pricing["directBenefits"][number]>) =>
    setBenefits((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otaPricing = otas.map((ota) => ({
      ...ota,
      nightlyRate: Number(ota.nightlyRate),
      serviceFeePercent: Number(ota.serviceFeePercent),
      cleaningFee: Number(ota.cleaningFee),
    }));
    void save.run(() => savePricing({ propertyId, directRate: Number(directRate), otaPricing, directBenefits: benefits }));
  }

  function remove() {
    if (!window.confirm("Delete this villa's price comparison?")) return;
    void save.run(async () => {
      await deletePricing({ propertyId });
      setDirectRate("");
      setOtas([]);
      setBenefits([]);
    });
  }

  return (
    <Section
      title="Price comparison"
      description="The direct rate against OTA rates (nightly rate + service fee + cleaning), plus perks for booking direct."
    >
      <form onSubmit={submit} className="grid gap-5">
        <Field label={`Direct rate per night (${currency})`} htmlFor="pc-direct" className="max-w-56">
          <Input id="pc-direct" type="number" min={0} value={directRate} onChange={(e) => setDirectRate(e.target.value)} required />
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">OTA rates</legend>
          {otas.map((ota, index) => (
            <div key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_1fr_90px_1fr_70px_auto]">
              <Input aria-label="Platform id" placeholder="booking.com" value={ota.platform} onChange={(e) => updateOta(index, { platform: e.target.value })} required />
              <Input aria-label="Display name" placeholder="Booking.com" value={ota.displayName} onChange={(e) => updateOta(index, { displayName: e.target.value })} required />
              <NumberInput label="Nightly rate" value={ota.nightlyRate} onChange={(nightlyRate) => updateOta(index, { nightlyRate })} />
              <NumberInput label="Service fee %" value={ota.serviceFeePercent} max={100} onChange={(serviceFeePercent) => updateOta(index, { serviceFeePercent })} />
              <NumberInput label="Cleaning fee" value={ota.cleaningFee} onChange={(cleaningFee) => updateOta(index, { cleaningFee })} />
              <Input aria-label="Logo text" placeholder="B" value={ota.logo} onChange={(e) => updateOta(index, { logo: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" aria-label="Remove rate" onClick={() => setOtas((rows) => rows.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOtas((rows) => [...rows, EMPTY_OTA])}>
            <PlusIcon aria-hidden className="size-4" />
            Add OTA rate
          </Button>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Direct booking benefits</legend>
          {benefits.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input aria-label="Benefit" value={row.benefit} onChange={(e) => updateBenefit(index, { benefit: e.target.value })} required />
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-foreground" checked={row.directOnly} onChange={(e) => updateBenefit(index, { directOnly: e.target.checked })} />
                Direct only
              </label>
              <Button type="button" size="sm" variant="ghost" aria-label="Remove benefit" onClick={() => setBenefits((rows) => rows.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setBenefits((rows) => [...rows, { benefit: "", directOnly: true }])}>
            <PlusIcon aria-hidden className="size-4" />
            Add benefit
          </Button>
        </fieldset>

        <SaveBar save={save}>
          {pricing ? (
            <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={remove} disabled={save.saving}>
              Delete comparison
            </Button>
          ) : null}
        </SaveBar>
      </form>
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
