"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { ChevronLeft, ExternalLink, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { IcalSourcesPanel } from "./IcalSourcesDialog";
import { OtaRatesPanel } from "./OtaRatesDialog";
import { PropertyPhotosEditor } from "./PropertyPhotosEditor";
import { PropertyReviewsEditor } from "./PropertyReviewsEditor";
import { PropertyRoomsEditor } from "./PropertyRoomsEditor";
import { StatusBadge } from "./StatusBadge";
import { Field, PROPERTY_STATUS, SaveBar, Section, useSaver, type PropertyStatus } from "./property-form";

type Property = Doc<"properties">;

const TABS = [
  ["details", "Details"],
  ["photos", "Photos"],
  ["rooms", "360 rooms"],
  ["pricing", "Pricing & OTA"],
  ["reviews", "Reviews"],
  ["calendar", "Calendar sync"],
] as const;
type Tab = (typeof TABS)[number][0];

export function AdminPropertyEditor({ propertyId }: { propertyId: string }) {
  const data = useQuery(api.adminProperties.get, { propertyId });
  const [tab, setTab] = useState<Tab>("details");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + TABS.length) % TABS.length;
    setTab(TABS[next][0]);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/admin/properties">
          <ChevronLeft aria-hidden className="size-4" />
          All villas
        </Link>
      </Button>
      {data === undefined ? (
        <div role="status" aria-label="Loading villa" className="grid gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-96 max-w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : data === null ? (
        <p className="text-sm text-muted-foreground">This villa doesn&apos;t exist (it may have been deleted).</p>
      ) : (
        <>
          <PropertyHeader property={data.property} deleteBlocker={data.deleteBlocker} />
          <div role="tablist" aria-label="Villa sections" className="flex gap-6 overflow-x-auto border-b border-border">
            {TABS.map(([key, label], index) => (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={`villa-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls="villa-tabpanel"
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="villa-tabpanel" aria-labelledby={`villa-tab-${tab}`} className="grid gap-4">
            {tab === "details" ? (
              <>
                <DetailsForm key={data.property._id} property={data.property} />
                <SlugForm property={data.property} locked={data.slugLocked} />
              </>
            ) : tab === "photos" ? (
              <PropertyPhotosEditor property={data.property} />
            ) : tab === "rooms" ? (
              <PropertyRoomsEditor propertyId={data.property._id} rooms={data.rooms} />
            ) : tab === "pricing" ? (
              <Section
                title="OTA rates"
                description="Nightly prices on Booking.com, Agoda, Airbnb and Expedia, shown to guests next to the direct price. The direct price and discount are under Details."
              >
                <OtaRatesPanel propertyId={data.property._id} />
              </Section>
            ) : tab === "reviews" ? (
              <PropertyReviewsEditor propertyId={data.property._id} />
            ) : (
              <Section title="Calendar sync" description="Import iCal feeds every 30 minutes and export confirmed bookings to other platforms.">
                <IcalSourcesPanel propertyId={data.property._id} />
              </Section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PropertyHeader({ property, deleteBlocker }: { property: Property; deleteBlocker: string | null }) {
  const setStatus = useMutation(api.adminProperties.setStatus);
  const deleteDraft = useMutation(api.adminProperties.deleteDraft);
  const duplicate = useMutation(api.adminProperties.duplicate);
  const confirm = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(errorText(err, "Could not update the villa."));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: PropertyStatus, title: string, description: string, confirmLabel: string) {
    if (!(await confirm({ title, description, confirmLabel }))) return;
    await act(() => setStatus({ propertyId: property._id, status }));
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${property.name}?`,
      description: "Its rooms, reviews, OTA rates and calendar feeds are deleted too. This can't be undone.",
      confirmLabel: "Delete villa",
      destructive: true,
    });
    if (!ok) return;
    await act(async () => {
      await deleteDraft({ propertyId: property._id });
      router.push("/admin/properties");
    });
  }

  return (
    <section className="flex flex-wrap items-center gap-3 border border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        {/* The admin header already has the page's h1 ("Villas"). */}
        <h2 className="flex items-center gap-2 truncate text-lg font-semibold text-foreground">
          {property.name}
          <StatusBadge {...PROPERTY_STATUS[property.status]} />
        </h2>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          /rooms/{property.slug}
          {property.status === "active" ? (
            <a href={`/rooms/${property.slug}`} target="_blank" rel="noreferrer" aria-label="Open the villa page" className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </p>
        {error ? <p role="alert" className="mt-1 text-sm text-destructive">{error}</p> : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title="New draft with these details, photos, 360 rooms and OTA rates"
        onClick={() =>
          act(async () => {
            const copyId = await duplicate({ propertyId: property._id });
            router.push(`/admin/properties/${copyId}`);
          })
        }
      >
        Duplicate
      </Button>
      {property.status === "draft" ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || deleteBlocker !== null}
            aria-describedby={deleteBlocker ? "delete-blocker" : undefined}
            onClick={remove}
          >
            Delete draft
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              changeStatus("active", "Publish this villa?", "Guests can see and book it, and the AI concierge offers it in chat.", "Publish")
            }
          >
            Publish
          </Button>
        </>
      ) : property.status === "active" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            changeStatus("archived", "Archive this villa?", "It's hidden from guests and chat. Existing bookings stay as they are. You can restore it later.", "Archive")
          }
        >
          Archive
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => changeStatus("active", "Restore this villa?", "Guests can see and book it again.", "Restore")}
        >
          Restore
        </Button>
      )}
      {property.status === "draft" && deleteBlocker ? (
        <p id="delete-blocker" className="w-full text-xs text-muted-foreground">
          {deleteBlocker}
        </p>
      ) : null}
    </section>
  );
}

function DetailsForm({ property }: { property: Property }) {
  const update = useMutation(api.properties.update);
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
      }),
    );
  }

  return (
    <Section title="Details" description="Used by the AI concierge, the chat channels and the booking flow.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Name" htmlFor="pr-name">
          <Input id="pr-name" name="name" defaultValue={property.name} required />
        </Field>
        <Field label="Tagline" htmlFor="pr-tagline">
          <Input id="pr-tagline" name="tagline" defaultValue={property.tagline} />
        </Field>
        <Field label="Description" htmlFor="pr-description">
          <Textarea id="pr-description" name="description" defaultValue={property.description} className="min-h-24" />
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
        <Field label="Amenities (one per line)" htmlFor="pr-amenities">
          <Textarea id="pr-amenities" name="amenities" defaultValue={property.amenities.join("\n")} className="min-h-40" />
        </Field>
        <SaveBar save={save} />
      </form>
    </Section>
  );
}

function SlugForm({ property, locked }: { property: Property; locked: boolean }) {
  const setSlug = useMutation(api.adminProperties.setSlug);
  const [slug, setSlugValue] = useState(property.slug);
  const save = useSaver();

  return (
    <Section title="Web address" description="The villa page lives at /rooms/<web address>. Lowercase letters, numbers and dashes.">
      {locked ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium text-foreground">/rooms/{property.slug}</span> is locked because this villa has bookings:
            confirmation emails, payment links and guests&apos; saved links point to it.
          </span>
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run(async () => setSlugValue(await setSlug({ propertyId: property._id, slug })));
          }}
        >
          <Field label="Web address" htmlFor="pr-slug" className="min-w-60 flex-1">
            <Input id="pr-slug" value={slug} onChange={(event) => setSlugValue(event.target.value)} required />
          </Field>
          <SaveBar save={save} compact />
        </form>
      )}
    </Section>
  );
}
