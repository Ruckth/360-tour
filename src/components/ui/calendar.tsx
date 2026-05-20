"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";
import { buttonVariants } from "@/components/ui/button";
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
        root: cn(defaultClassNames.root),
        months: "flex flex-col gap-4",
        month: "space-y-4",
        month_caption: "flex h-9 items-center justify-center",
        caption_label: "text-sm font-semibold text-foreground",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "h-8 w-8 bg-transparent p-0",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "h-8 w-8 bg-transparent p-0",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-[0.8rem] font-medium text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "relative h-9 w-9 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
        ),
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
