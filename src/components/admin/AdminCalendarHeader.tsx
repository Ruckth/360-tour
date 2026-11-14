"use client";

import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  useEventCalendarNavigation,
  useEventCalendarSettings,
  useEventCalendarView,
} from "@/components/reui/event-calendar/event-calendar";
import {
  EventCalendarDatePicker,
  EventCalendarNavNext,
  EventCalendarNavPrev,
  EventCalendarNavToday,
  EventCalendarTitle,
} from "@/components/reui/event-calendar/event-calendar-nav";
import { TooltipProvider } from "@/components/reui/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toZoned } from "@/components/reui/event-calendar/event-calendar-lib";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Phones get date navigation and a compact view picker; tablets share the segmented header. */
export function AdminCalendarHeader({
  children,
  compact = false,
  primaryAction,
}: {
  children?: ReactNode;
  compact?: boolean;
  primaryAction?: ReactNode;
}) {
  const { view, dayCount, availableViews, setView } = useEventCalendarView();
  const { title, date } = useEventCalendarNavigation();
  const { i18n, timeZone } = useEventCalendarSettings();
  const shortTitle = format(toZoned(date, timeZone), compact ? "MMM yyyy" : "d MMM");
  const viewName = (option: (typeof availableViews)[number]) =>
    option === "days" ? i18n.viewNames.days(dayCount) : i18n.viewNames[option];
  const picker = (
    <EventCalendarDatePicker
      aria-label={`${shortTitle}, ${title}, ${i18n.labels.goToDate.toLowerCase()}`}
      showToday
      className="h-9 w-auto min-w-0 shrink-0 gap-1 px-1 pointer-coarse:min-h-11"
    >
      <span className="text-[13px] font-semibold sm:hidden">{shortTitle}</span>
      <EventCalendarTitle render={<span />} className="hidden text-[15px] font-semibold sm:inline" />
      <ChevronDown aria-hidden className="size-3 shrink-0" />
    </EventCalendarDatePicker>
  );
  const mobileView = (
    <Select value={view} onValueChange={(next) => setView(next as typeof view)}>
      <SelectTrigger
        aria-label="Calendar view"
        className="h-9 w-auto gap-1 rounded-full px-2 text-xs pointer-coarse:min-h-11"
      >
        <SelectValue>{viewName(view)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {availableViews.map((option) => (
          <SelectItem key={option} value={option}>
            {viewName(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="border-b border-border" data-testid="calendar-toolbar">
      <TooltipProvider delay={400}>
        <div className="hidden flex-wrap items-center gap-2 px-4 py-3 sm:flex">
          <EventCalendarNavToday className="h-9 px-3 pointer-coarse:min-h-11" />
          <EventCalendarNavPrev className="size-9 pointer-coarse:size-11" />
          {picker}
          <EventCalendarNavNext className="size-9 pointer-coarse:size-11" />
          <ToggleGroup
            variant="segmented"
            value={view}
            onValueChange={setView}
            aria-label="Calendar view"
            className="ms-auto p-0.5"
          >
            {availableViews.map((option) => (
              <ToggleGroupItem key={option} value={option} className="h-9! pointer-coarse:h-11! data-[state=on]:bg-background! data-[state=on]:text-foreground!">
                {viewName(option)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="shrink-0">{primaryAction}</div>
        </div>
        <div className="flex items-center gap-0.5 px-2 py-2 sm:hidden">
          <EventCalendarNavPrev className="size-9 shrink-0 pointer-coarse:size-11" />
          {picker}
          <EventCalendarNavNext className="size-9 shrink-0 pointer-coarse:size-11" />
          <div className="ms-auto shrink-0">{primaryAction}</div>
        </div>
        <div className="flex items-center gap-1.5 border-t border-border px-2 py-2 sm:flex-wrap sm:gap-2 sm:px-4">
          <div className="sm:hidden">{mobileView}</div>
          {children}
        </div>
      </TooltipProvider>
    </div>
  );
}
