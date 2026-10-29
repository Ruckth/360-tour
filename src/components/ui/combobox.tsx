"use client";

// The Base UI combobox surface needed by the ReUI phone registry component.
// Uses our existing Input/Button styling without replacing shared shadcn components.
import { useRef } from "react";
import { Combobox as Primitive } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Combobox = Primitive.Root;
export const ComboboxValue = Primitive.Value;

export function ComboboxTrigger({
  children,
  className,
  ...props
}: Primitive.Trigger.Props) {
  return (
    <Primitive.Trigger
      data-slot="combobox-trigger"
      className={className}
      {...props}
    >
      {children}
      <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
    </Primitive.Trigger>
  );
}

export function ComboboxInput({
  showTrigger = true,
  ...props
}: Primitive.Input.Props & { showTrigger?: boolean }) {
  return (
    <div className="m-1 flex items-center">
      <Primitive.Input render={<Input />} {...props} />
      {showTrigger ? <ComboboxTrigger /> : null}
    </div>
  );
}

export function ComboboxContent({
  className,
  ...props
}: Primitive.Popup.Props) {
  // Keep a nested selector inside the owning Radix dialog's focus and pointer boundary.
  const container = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={container} />
      <Primitive.Portal container={container}>
        <Primitive.Positioner sideOffset={6} className="z-[90]">
          <Primitive.Popup
            data-slot="combobox-content"
            className={cn(
              "group/combobox-content max-h-(--available-height) max-w-(--available-width) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md",
              className,
            )}
            {...props}
          />
        </Primitive.Positioner>
      </Primitive.Portal>
    </>
  );
}

export function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List
      className={cn(
        "max-h-[min(18rem,calc(var(--available-height)-4rem))] overflow-y-auto overscroll-contain p-1",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxItem({
  children,
  className,
  ...props
}: Primitive.Item.Props) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md py-2 pl-2 pr-8 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.ItemIndicator className="absolute right-2">
        <Check aria-hidden className="size-4" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}

export function ComboboxEmpty(props: Primitive.Empty.Props) {
  return <Primitive.Empty {...props} />;
}

export function ComboboxSeparator({
  className,
  ...props
}: Primitive.Separator.Props) {
  return (
    <Primitive.Separator
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
