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
import { cn } from "@/lib/utils";

/** Every toolbar control is h-9, matching `Button size="sm"` in the page's own filters and actions. */
const TOOLBAR = "flex flex-wrap items-center gap-2 px-4 py-3";

/**
 * Shared admin calendar header. Row 1: Today, prev/next, the period title (click to jump
 * to any date) and the view buttons. Row 2: the page's filters (left) and actions (right),
 * wrapping on small screens instead of squeezing the navigation.
 */
export function AdminCalendarHeader({ children }: { children?: ReactNode }) {
  const { view, dayCount, availableViews, setView } = useEventCalendarView();
  const { title } = useEventCalendarNavigation();
  const { i18n } = useEventCalendarSettings();

  return (
    <div className="border-b border-border">
      <TooltipProvider delay={400}>
        <div className={TOOLBAR}>
          <div className="flex items-center gap-1">
            <EventCalendarNavToday className="h-9 px-3 text-xs font-semibold" />
            <EventCalendarNavPrev className="size-9" />
            <EventCalendarNavNext className="size-9" />
          </div>
          <EventCalendarDatePicker
            aria-label={`${title}, ${i18n.labels.goToDate.toLowerCase()}`}
            className="h-9 w-auto max-w-full min-w-0 gap-1.5 px-2.5 font-semibold"
          >
            <CalendarDays aria-hidden className="size-4 shrink-0 text-gold-text" />
            <EventCalendarTitle render={<span />} className="text-sm" />
            <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
          </EventCalendarDatePicker>
          {availableViews.length > 1 ? (
            <div
              role="group"
              aria-label="Calendar view"
              className="flex h-9 w-full rounded-lg border border-border bg-muted/40 p-0.5 sm:ms-auto sm:w-auto"
            >
              {availableViews.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    "flex-1 rounded-md px-3 text-xs font-semibold whitespace-nowrap text-muted-foreground transition outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
                    view === option ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
                  )}
                >
                  {option === "days" ? i18n.viewNames.days(dayCount) : i18n.viewNames[option]}
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
