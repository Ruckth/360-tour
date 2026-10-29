"use client";

import { Command } from "cmdk";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Fragment,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { matchPickerSearch } from "@/lib/picker";
import { cn } from "@/lib/utils";

export type PickerOption<Value extends string> = {
  value: Value;
  label: string;
  group?: string;
  keywords?: string[];
  description?: string;
  renderThumbnail?: (className: string) => ReactNode;
  onPreview?: () => void;
};

/** Shared single-selection UI. Callers own ordering, domain values and photo previews. */
export function EntityPicker<Value extends string>({
  id,
  labelId,
  label,
  options,
  value,
  disabled,
  onChange,
  placeholder,
  searchLabel,
  emptyLabel,
  noResultsLabel,
  className,
  compact = false,
  interactionLocked = false,
  searchRef,
}: {
  id?: string;
  labelId?: string;
  label: string;
  options: PickerOption<Value>[];
  value: Value | undefined;
  disabled?: boolean;
  onChange: (value: Value) => void;
  placeholder: string;
  searchLabel: string;
  emptyLabel: string;
  noResultsLabel: string;
  className?: string;
  compact?: boolean;
  interactionLocked?: boolean;
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const groups = useMemo(() => {
    const grouped = new Map<string, PickerOption<Value>[]>();
    for (const option of options) {
      const group = option.group ?? "";
      const items = grouped.get(group);
      if (items) items.push(option);
      else grouped.set(group, [option]);
    }
    return [...grouped];
  }, [options]);

  // Open on the chosen row, keeping its category heading visible where it fits.
  function showChosen() {
    const box = list.current;
    const item = box?.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]',
    );
    const group = item?.closest<HTMLElement>("[cmdk-group]");
    if (!box || !item || !group) return;
    const offset = (element: HTMLElement) =>
      element.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop;
    const groupTop = offset(group);
    if (offset(item) + item.offsetHeight - groupTop <= box.clientHeight)
      box.scrollTop = groupTop;
    else item.scrollIntoView({ block: "nearest" });
  }
  const keepOpen = (event: Event) => {
    if (interactionLocked) event.preventDefault();
  };

  return (
    // Modal lets wheel/touch scrolling work inside an enclosing dialog's scroll lock.
    <Popover
      modal
      open={open}
      onOpenChange={(next) => !interactionLocked && setOpen(next)}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={
            labelId ? undefined : `${label}: ${selected?.label ?? placeholder}`
          }
          aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
          disabled={disabled}
          className={cn(
            "flex h-11 w-full min-w-0 items-center gap-2.5 rounded-lg border border-input bg-background pl-1.5 pr-3 text-left text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            compact && "h-9",
            className,
          )}
        >
          {selected?.renderThumbnail?.(
            compact ? "size-6 rounded-md" : "size-8 rounded-md",
          )}
          <span
            id={valueId}
            className={cn(
              "min-w-0 flex-1 truncate",
              !selected?.renderThumbnail && "pl-1.5",
              !selected && "font-normal text-muted-foreground",
            )}
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 opacity-75" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[max(var(--radix-popover-trigger-width),20rem)] max-w-[calc(100vw-2rem)] p-0"
        onInteractOutside={keepOpen}
        onFocusOutside={keepOpen}
        onEscapeKeyDown={keepOpen}
        onOpenAutoFocus={() =>
          requestAnimationFrame(() => requestAnimationFrame(showChosen))
        }
      >
        <Command
          label={searchLabel}
          loop
          filter={matchPickerSearch}
          defaultValue={selected?.value}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <div className="m-1.5 mb-0.5 flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:border-ring">
            <Search
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <Command.Input
              ref={searchRef}
              onValueChange={() =>
                requestAnimationFrame(() => {
                  if (list.current) list.current.scrollTop = 0;
                })
              }
              placeholder={`${searchLabel}…`}
              aria-label={searchLabel}
              className="h-10 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
          </div>
          <Command.List
            ref={list}
            className="max-h-[min(22rem,calc(var(--radix-popover-content-available-height)-3.5rem))] overflow-y-auto overscroll-contain px-1 pb-1"
          >
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {options.length ? noResultsLabel : emptyLabel}
            </Command.Empty>
            {groups.map(([group, items], index) => (
              <Fragment key={group}>
                {index > 0 ? (
                  <Command.Separator className="-mx-1 my-1 h-px bg-border" />
                ) : null}
                <Command.Group heading={group || undefined}>
                  {items.map((option) => (
                    <Command.Item
                      key={option.value}
                      value={option.value}
                      keywords={[
                        option.label,
                        group,
                        ...(option.keywords ?? []),
                      ]}
                      onSelect={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-muted"
                    >
                      {option.onPreview ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-hidden
                          aria-label={`View photo of ${option.label}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            option.onPreview?.();
                          }}
                          className="shrink-0 cursor-zoom-in rounded-lg transition hover:opacity-85"
                        >
                          {option.renderThumbnail?.("size-10")}
                        </button>
                      ) : (
                        option.renderThumbnail?.("size-10")
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-medium leading-snug">
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      <Check
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0",
                          option.value === value ? "opacity-100" : "opacity-0",
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
  );
}
