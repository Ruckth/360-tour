"use client";

import type { Doc, Id } from "convex/_generated/dataModel";
import { useMemo, useRef, useState } from "react";
import {
  ServicePhotoLightbox,
  ServiceThumb,
  serviceSummary,
} from "@/components/admin/ServicePhoto";
import { EntityPicker } from "@/components/ui/entity-picker";
import { groupServices } from "@/lib/service-picker";

type Service = Doc<"services">;

export function ServicePicker({
  id,
  labelId,
  services,
  value,
  disabled,
  onChange,
}: {
  id?: string;
  labelId?: string;
  services: Service[];
  value: Id<"services"> | undefined;
  disabled?: boolean;
  onChange: (serviceId: Id<"services">) => void;
}) {
  const [viewing, setViewing] = useState<Service | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const options = useMemo(
    () =>
      groupServices(services).flatMap(([group, items]) =>
        items.map((service) => ({
          value: service._id,
          label: service.name,
          group,
          description: serviceSummary(service),
          renderThumbnail: (className: string) => (
            <ServiceThumb service={service} className={className} />
          ),
          onPreview: service.imageUrl ? () => setViewing(service) : undefined,
        })),
      ),
    [services],
  );

  return (
    <>
      <EntityPicker
        id={id}
        labelId={labelId}
        label="Service"
        options={options}
        value={value}
        disabled={disabled}
        onChange={onChange}
        placeholder="Choose a service"
        searchLabel="Search services"
        emptyLabel="No services yet. Add one under Services."
        noResultsLabel="No services match."
        interactionLocked={viewing !== null}
        searchRef={search}
      />
      <ServicePhotoLightbox
        service={viewing}
        onClose={() => setViewing(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
      />
    </>
  );
}
