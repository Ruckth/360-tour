import { createRoot } from "react-dom/client";
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import "@/app.css";

const automatic = new URLSearchParams(location.search).has("auto");
const at = (day: number, hour = 0) => new Date(2026, 10, day, hour);
createRoot(document.getElementById("root")!).render(<main className="p-4" data-fixture-ready>
  <EventCalendar date={at(12)} view="month" views={["month"]} fixedWeeks={false} maxEventsPerCell={automatic ? "auto" : 2} className="h-[44rem]" events={[
    { id: "first", title: "Early stay", start: at(9), end: at(12), allDay: true },
    { id: "second", title: "Long stay", start: at(10), end: at(automatic ? 18 : 15), allDay: true },
    { id: "friday", title: "Friday arrival in free lane", start: at(13, 14), end: at(13, 15) },
    { id: "saturday", title: "Saturday first arrival", start: at(14, 14), end: at(14, 15) },
    { id: "overflow", title: "Saturday overflow arrival", start: at(14, 16), end: at(14, 17) },
  ]}><EventCalendarContent /></EventCalendar>
</main>);
