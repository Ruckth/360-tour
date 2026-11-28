"use client";

import { format } from "date-fns";
import { ChevronDown, SearchIcon, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Phones get date navigation and a compact view picker; tablets share the segmented header. */
export function AdminCalendarHeader({
  children,
  compact = false,
  primaryAction,
  search,
}: {
  children?: ReactNode;
  compact?: boolean;
  primaryAction?: ReactNode;
  search?: ReactNode;
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
        className="h-9 w-auto gap-1 rounded-full px-2 text-sm pointer-coarse:min-h-11"
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
    <div className={compact
      ? "flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1.5 sm:block sm:p-0 [&_button]:text-[13px] pointer-coarse:[&_button]:text-sm"
      : "border-b border-border [&_button]:text-[13px] pointer-coarse:[&_button]:text-sm"} data-testid="calendar-toolbar">
      <TooltipProvider delay={400}>
        <div className="hidden flex-wrap items-center gap-2 px-4 py-3 sm:flex">
          <EventCalendarNavToday className="h-9 px-3 pointer-coarse:min-h-11" />
          <EventCalendarNavPrev className="size-9 pointer-coarse:size-11" />
          {picker}
          <EventCalendarNavNext className="size-9 pointer-coarse:size-11" />
          <ToggleGroup
            variant="segmented"
            tone="subtle"
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
        <div className={compact ? "flex flex-1 items-center gap-0.5 sm:hidden" : "flex items-center gap-0.5 px-2 py-2 sm:hidden"}>
          <EventCalendarNavPrev className="size-9 shrink-0 pointer-coarse:size-11" />
          {picker}
          <EventCalendarNavNext className="size-9 shrink-0 pointer-coarse:size-11" />
          <div className="ms-auto shrink-0">{primaryAction}</div>
        </div>
        <div className={compact
          ? "flex flex-1 flex-wrap items-center gap-1.5 sm:gap-2 sm:border-t sm:border-border sm:px-4 sm:py-2"
          : "flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-2 sm:gap-2 sm:px-4"}>
          {search}
          <div className="sm:hidden">{mobileView}</div>
          {children}
        </div>
      </TooltipProvider>
    </div>
  );
}

/** A live schedule filter stays visible; the booking lookup can collapse on a phone. */
export function AdminCalendarSearch({ label, placeholder, value, onChange, inline = false, open, onOpenChange, children }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  inline?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const phone = useIsMobile(640);
  const field = useRef<HTMLInputElement>(null);
  const content = <div className={inline ? "relative min-w-0 basis-full sm:flex-1 sm:max-w-60" : "relative min-w-0 flex-1 sm:max-w-60"}>
    <SearchIcon aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input ref={field} type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} className={inline ? "h-11 ps-9 pe-11 sm:h-9 pointer-coarse:min-h-11 [&::-webkit-search-cancel-button]:hidden" : "h-9 ps-9 pointer-coarse:min-h-11"} />
    {inline && value ? (
      <Button type="button" variant="ghost" size="icon" aria-label="Clear search" className="absolute inset-y-0 end-0 h-full w-11" onClick={() => {
        onChange("");
        field.current?.focus();
      }}>
        <X aria-hidden className="size-4" />
      </Button>
    ) : null}
    {children}
  </div>;
  return phone && !inline ? <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger asChild><Button size="icon" variant="outline" aria-label={label}><SearchIcon aria-hidden className="size-4" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))]">{content}</PopoverContent></Popover> : content;
}
