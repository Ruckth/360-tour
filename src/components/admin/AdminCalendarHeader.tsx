"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Every toolbar control is h-9, matching `Button size="sm"` in the page's own filters and actions. */
const TOOLBAR = "flex flex-wrap items-center gap-2 px-4 py-3";

/**
 * Shared admin calendar header. Row 1: Today, prev/next, the period title (click to jump
 * to any date) and the view buttons. Row 2: the page's filters (left) and actions (right),
 * wrapping on small screens instead of squeezing the navigation.
 *
 * `compact` (the hotel calendar) is one row: prev/next, the title with Today inside its picker,
 * the views as one select, then the page's controls.
 */
export function AdminCalendarHeader({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  const { view, dayCount, availableViews, setView } = useEventCalendarView();
  const { title } = useEventCalendarNavigation();
  const { i18n } = useEventCalendarSettings();
  const viewName = (option: (typeof availableViews)[number]) => (option === "days" ? i18n.viewNames.days(dayCount) : i18n.viewNames[option]);

  const picker = (
    <EventCalendarDatePicker
      aria-label={`${title}, ${i18n.labels.goToDate.toLowerCase()}`}
      className="h-9 w-auto max-w-full min-w-0 gap-1.5 px-2.5 font-semibold"
      showToday={compact}
    >
      <CalendarDays aria-hidden className="size-4 shrink-0 text-gold-text" />
      <EventCalendarTitle render={<span />} className="text-sm" />
      <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
    </EventCalendarDatePicker>
  );

  if (compact) {
    return (
      <div className="border-b border-border">
        <TooltipProvider delay={400}>
          <div className={TOOLBAR} data-testid="calendar-toolbar">
            <div className="flex min-w-0 items-center gap-1">
              <EventCalendarNavPrev className="size-9" />
              <EventCalendarNavNext className="size-9" />
              {picker}
            </div>
            {availableViews.length > 1 ? (
              <Select value={view} onValueChange={(next) => setView(next as typeof view)}>
                <SelectTrigger aria-label="Calendar view" className="h-9 w-auto gap-1.5 rounded-lg px-2.5 text-xs font-semibold">
                  <SelectValue>{viewName(view)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableViews.map((option) => (
                    <SelectItem key={option} value={option}>{viewName(option)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {children}
          </div>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <div className="border-b border-border">
      <TooltipProvider delay={400}>
        <div className={TOOLBAR}>
          <div className="flex items-center gap-1">
            <EventCalendarNavToday className="h-9 px-3 text-xs font-semibold" />
            <EventCalendarNavPrev className="size-9" />
            <EventCalendarNavNext className="size-9" />
          </div>
          {picker}
          {availableViews.length > 1 ? (
            <div
              role="group"
              aria-label="Calendar view"
              className="flex min-h-9 w-full rounded-lg border border-border bg-muted p-1 sm:ms-auto sm:w-auto"
            >
              {availableViews.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    "min-h-9 flex-1 rounded-md px-3 text-xs font-semibold whitespace-nowrap text-muted-foreground transition outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
                    view === option ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "hover:text-foreground",
                  )}
                >
                  {viewName(option)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </TooltipProvider>
      {children ? (
        <div className={`${TOOLBAR} border-t border-border`}>{children}</div>
      ) : null}
    </div>
  );
}
