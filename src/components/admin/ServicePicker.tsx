"use client";

import type { Doc, Id } from "convex/_generated/dataModel";
import { Command } from "cmdk";
import { Check, ChevronDown, Search } from "lucide-react";
import { Fragment, useId, useMemo, useRef, useState } from "react";
import {
  ServicePhotoLightbox,
  ServiceThumb,
  serviceSummary,
} from "@/components/admin/ServicePhoto";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { groupServices, matchServiceSearch } from "@/lib/service-picker";
import { cn } from "@/lib/utils";

type Service = Doc<"services">;

/** Searchable service select, grouped by category, with photos that open large. */
export function ServicePicker({
  id,
  labelId,
  services,
  value,
  disabled,
  onChange,
}: {
  id?: string;
  /** The visible label's id; the trigger's name is the label plus the chosen service. */
  labelId?: string;
  services: Service[];
  value: Id<"services"> | undefined;
  disabled?: boolean;
  onChange: (serviceId: Id<"services">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Service | null>(null);
  const groups = useMemo(() => groupServices(services), [services]);
  const valueId = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = services.find((s) => s._id === value);
  /**
   * Scrolls the chosen service into view, cmdk doesn't. Its group starts at the top when the group fits,
   * so the list opens on a whole group rather than mid-way through one.
   */
  function showChosen() {
    const box = list.current;
    const item = box?.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]',
    );
    const group = item?.closest<HTMLElement>("[cmdk-group]");
    if (!box || !item || !group) return;
    const offset = (el: HTMLElement) =>
      el.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop;
    const groupTop = offset(group);
    if (offset(item) + item.offsetHeight - groupTop <= box.clientHeight)
      box.scrollTop = groupTop;
    else item.scrollIntoView({ block: "nearest" });
  }
  // While a photo is open the list stays open behind it, so closing the photo returns to the list.
  const keepOpen = (event: Event) => {
    if (viewing) event.preventDefault();
  };

  return (
    <>
      {/* Modal, so the appointment dialog's scroll lock doesn't block wheel and touch scrolling in the list. */}
      <Popover
        modal
        open={open}
        onOpenChange={(next) => !viewing && setOpen(next)}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
            disabled={disabled}
            className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-lg border border-input bg-background pl-1.5 pr-3 text-left text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selected ? (
              <>
                <ServiceThumb
                  service={selected}
                  className="size-8 rounded-md"
                />
                <span id={valueId} className="min-w-0 flex-1 truncate">
                  {selected.name}
                </span>
              </>
            ) : (
              <span
                id={valueId}
                className="min-w-0 flex-1 truncate pl-1.5 font-normal text-muted-foreground"
              >
                Choose a service
              </span>
            )}
            <ChevronDown aria-hidden className="size-4 shrink-0 opacity-75" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[max(var(--radix-popover-trigger-width),20rem)] max-w-[calc(100vw-2rem)] p-0"
          onInteractOutside={keepOpen}
          onFocusOutside={keepOpen}
          onEscapeKeyDown={keepOpen}
          // cmdk marks the chosen service a frame after mount, hence two frames.
          onOpenAutoFocus={() =>
            requestAnimationFrame(() => requestAnimationFrame(showChosen))
          }
        >
          <Command
            loop
            filter={matchServiceSearch}
            defaultValue={selected?._id}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {/* A boxed field rather than a full-width rule, so it never doubles up with a group divider below it. */}
            <div className="m-1.5 mb-0.5 flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:border-ring">
              <Search
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <Command.Input
                ref={search}
                // New results start at the top, group heading included; cmdk only scrolls to the first item.
                onValueChange={() =>
                  requestAnimationFrame(() => {
                    if (list.current) list.current.scrollTop = 0;
                  })
                }
                placeholder="Search services…"
                aria-label="Search services"
                className="h-10 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              />
            </div>
            <Command.List
              ref={list}
              className="max-h-[min(22rem,calc(var(--radix-popover-content-available-height)-3.5rem))] overflow-y-auto overscroll-contain px-1 pb-1"
            >
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                {services.length
                  ? "No services match."
                  : "No services yet. Add one under Services."}
              </Command.Empty>
              {groups.map(([category, items], index) => (
                <Fragment key={category}>
                  {index > 0 ? (
                    <Command.Separator className="-mx-1 my-1 h-px bg-border" />
                  ) : null}
                  <Command.Group heading={category}>
                    {items.map((service) => (
                      <Command.Item
                        key={service._id}
                        value={service._id}
                        keywords={[service.name, category]}
                        onSelect={() => {
                          onChange(service._id);
                          setOpen(false);
                        }}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-muted"
                      >
                        {service.imageUrl ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            // Pointer-only extra: hidden so the option reads as just the service.
                            aria-hidden
                            aria-label={`View photo of ${service.name}`}
                            // Opens the photo without choosing the service.
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setViewing(service);
                            }}
                            className="shrink-0 cursor-zoom-in rounded-lg transition hover:opacity-85"
                          >
                            <ServiceThumb
                              service={service}
                              className="size-10"
                            />
                          </button>
                        ) : (
                          <ServiceThumb service={service} className="size-10" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium leading-snug">
                            {service.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {serviceSummary(service)}
                          </span>
                        </span>
                        <Check
                          aria-hidden
                          className={cn(
                            "size-4 shrink-0",
                            service._id === value ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </Command.Item>
                    ))}
                  </Command.Group>
                </Fragment>
              ))}
            </Command.List>
          </Command>
        </PopoverContent>
      </Popover>
      <ServicePhotoLightbox
        service={viewing}
        onClose={() => setViewing(null)}
        // Back to the still-open list; the photo button has no trigger for Radix to return to.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
      />
    </>
  );
}
