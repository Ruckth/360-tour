"use client";

import type { Doc } from "convex/_generated/dataModel";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { initials } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

type ServiceLike = Pick<Doc<"services">, "name" | "category" | "imageUrl">;

/** Soft tiles for services without a photo; the category picks one, so a group shares a colour. */
const TILE_TONES = [
  "bg-emerald-100 text-emerald-900",
  "bg-sky-100 text-sky-900",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-900",
  "bg-violet-100 text-violet-900",
  "bg-teal-100 text-teal-900",
];

function tileTone(category: string) {
  let hash = 0;
  for (const char of category.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TILE_TONES[Math.abs(hash) % TILE_TONES.length];
}

/** The service photo as a square, or its initials on a category-coloured tile. */
export function ServiceThumb({ service, className }: { service: ServiceLike; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return service.imageUrl && failedUrl !== service.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={service.imageUrl} alt="" onError={() => setFailedUrl(service.imageUrl)} className={cn("size-9 shrink-0 rounded-lg bg-muted object-cover", className)} />
  ) : (
    <span
      aria-hidden
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold", tileTone(service.category), className)}
    >
      {initials(service.name)}
    </span>
  );
}

export function serviceSummary(service: Pick<Doc<"services">, "durationMin" | "price" | "currency">) {
  return `${service.durationMin} min · ${formatMoney(service.price, service.currency)}`;
}

/** A service photo shown large, so staff can see what they are booking. */
export function ServicePhotoLightbox({
  service,
  onClose,
  onCloseAutoFocus,
}: {
  service: (ServiceLike & Pick<Doc<"services">, "durationMin" | "price" | "currency" | "description">) | null;
  onClose: () => void;
  /** Where focus goes on close: Radix can't return it on its own, as no `DialogTrigger` opened it. */
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog open={service !== null && !!service.imageUrl} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={onCloseAutoFocus} className="max-h-[calc(100dvh-2rem)] max-w-3xl gap-3 overflow-y-auto p-3 sm:p-4">
        {service?.imageUrl ? (
          <>
            {/* Solid, so it stays visible over any photo. */}
            <DialogClose className="absolute right-5 top-5 z-10 flex size-10 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-6 sm:top-6">
              <X aria-hidden className="size-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={service.imageUrl}
              alt={`Photo of ${service.name}`}
              className="max-h-[min(70dvh,640px)] w-full rounded-lg bg-muted object-contain"
            />
            <div className="grid gap-0.5 px-1">
              <DialogTitle className="text-base">{service.name}</DialogTitle>
              <DialogDescription>
                {service.category} · {serviceSummary(service)}
                {service.description ? <span className="mt-1 block">{service.description}</span> : null}
              </DialogDescription>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** A service thumbnail that opens the photo large when it has one. */
export function ServiceThumbZoom({ service, className }: { service: Doc<"services">; className?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!service.imageUrl) return <ServiceThumb service={service} className={className} />;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`View photo of ${service.name}`}
        onClick={() => setOpen(true)}
        className="shrink-0 cursor-zoom-in rounded-lg outline-none transition hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ServiceThumb service={service} className={className} />
      </button>
      <ServicePhotoLightbox
        service={open ? service : null}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          button.current?.focus();
        }}
      />
    </>
  );
}
