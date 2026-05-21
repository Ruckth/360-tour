"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";
import { cn } from "@/lib/utils";

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: DayPickerProps) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-0", className)}
      classNames={{
        root: cn(defaultClassNames.root, "relative"),
        months: "flex flex-col gap-4",
        month: "relative space-y-4",
        month_caption: "pointer-events-none flex h-9 items-center justify-center px-10",
        caption_label: "text-sm font-semibold text-foreground",
        nav: "pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between",
        button_previous:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent p-0 text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35",
        button_next:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent p-0 text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35",
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "grid grid-cols-7",
        weekday:
          "flex h-9 items-center justify-center rounded-md text-[0.8rem] font-medium text-muted-foreground",
        week: "mt-2 grid grid-cols-7",
        day: "relative flex h-9 w-full items-center justify-center p-0 text-center text-sm",
        day_button:
          "inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-sm font-normal transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:opacity-100 disabled:pointer-events-none disabled:opacity-45",
        selected: "text-foreground",
        today:
          "rounded-md border border-gold bg-transparent font-semibold text-foreground",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-30",
        hidden: "invisible",
        range_start:
          "rounded-l-md bg-primary text-primary-foreground [&>button]:bg-primary [&>button]:text-primary-foreground hover:[&>button]:bg-primary hover:[&>button]:text-primary-foreground",
        range_end:
          "rounded-r-md bg-primary text-primary-foreground [&>button]:bg-primary [&>button]:text-primary-foreground hover:[&>button]:bg-primary hover:[&>button]:text-primary-foreground",
        range_middle:
          "rounded-none bg-gold-light/45 text-foreground [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground hover:[&>button]:bg-transparent",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
