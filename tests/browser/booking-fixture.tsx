import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import { registerFixtureFunctions } from "./convex-mock";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { BookingSheet } from "@/components/admin/BookingSheet";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { useState } from "react";
import { NewAppointmentDialog } from "@/components/admin/NewAppointmentDialog";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "@/platform/intl";
import { dateToIso } from "@/lib/booking/dates";
import en from "../../messages/en.json";
import th from "../../messages/th.json";
import { NewBookingDialog } from "@/components/admin/NewBookingDialog";
import type { AdminProperty } from "@/components/admin/admin-bookings-shared";
import type { Doc, Id } from "convex/_generated/dataModel";
import "@/app.css";

const params = new URLSearchParams(location.search);
const photo = params.has("broken")
  ? "/missing-photo.jpg"
  : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="teal"/%3E%3C/svg%3E';

const properties: AdminProperty[] = [
  {
    _id: "pool-id" as Id<"properties">,
    slug: "pool-villa",
    name: "Tideglass Pool Residence",
    imageUrl: photo,
    maxGuests: 6,
    status: "active",
    pricePerNight: 850000,
    currency: "THB",
    directDiscountPercent: 1500,
  },
  {
    _id: "garden-id" as Id<"properties">,
    slug: "garden-villa",
    name: "Garden Villa",
    maxGuests: 4,
    status: "active",
    pricePerNight: 420000,
    currency: "THB",
    directDiscountPercent: 0,
  },
];
const services: Doc<"services">[] = Array.from({ length: 30 }, (_, index) => ({
  _id: `service-${index}` as Id<"services">,
  _creationTime: 0,
  createdAt: 0,
  updatedAt: 0,
  slug: `service-${index}`,
  description: "",
  name: index === 0 ? "Thai Massage" : `Yoga ${String(index).padStart(2, "0")}`,
  category: index === 0 ? "Massage" : "Wellness",
  durationMin: 60,
  bufferMin: 0,
  price: 100000,
  currency: "THB",
  staffIds: [],
  status: "active",
  imageUrl: index === 0 ? photo : undefined,
}));

// Static server answers; the real hotel calendar owns selection and resort-day policy.
const hotelData = { properties, bookings: [], dateBlocks: [], blocks: [], complete: true };
if (params.get("mode") === "hotel-calendar") registerFixtureFunctions({
  queries: {
    "bookings/admin:listCalendarProperties": () => properties,
    "bookings/admin:listForAdmin": ({ propertyId }: { propertyId?: string }) => ({
      ...hotelData, properties: properties.filter((property) => !propertyId || property._id === propertyId),
    }),
  },
});

function PublicCalendarFixture() {
  const crossMonth = params.has("crossMonth");
  const [range, setRange] = useState(crossMonth
    ? { checkIn: "2025-02-27", checkOut: "2025-03-03" }
    : { checkIn: "2025-02-14", checkOut: "2025-02-17" });
  const [requestedMonth, setRequestedMonth] = useState("");
  return (
    <div data-testid="public-calendar" data-requested-month={requestedMonth}>
      <BookingRangePicker {...range} onChange={setRange}
        unavailableDates={["2025-02-15"]} isDateDisabled={() => !crossMonth}
        onMonthChange={(month) => setRequestedMonth(dateToIso(month))} />
    </div>
  );
}

function Fixture() {
  const [filter, setFilter] = useState("all");
  if (params.get("mode") === "hotel-calendar") return <ConfirmProvider><AdminBookingsView /></ConfirmProvider>;
  if (params.get("mode") === "public-calendar") return <PublicCalendarFixture />;
  if (params.get("mode") === "filter")
    return (
      <div className="p-8">
        <VillaPicker
          properties={params.has("empty") ? [] : properties}
          value={filter}
          onChange={setFilter}
          includeAll={!params.has("empty")}
          disabled={params.has("disabled")}
          compact
          className="flex-1 sm:w-48 sm:flex-none"
        />
      </div>
    );
  if (params.get("mode") === "service")
    return (
      <NewAppointmentDialog
        services={services}
        staff={[]}
        draft={{ date: "2027-11-27" }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
  if (params.get("mode") === "edit") return <ConfirmProvider>
    <BookingSheet bookingId={"booking-id" as Id<"bookings">} properties={properties} onClose={() => {}} />
  </ConfirmProvider>;
  return (
    <NewBookingDialog
      properties={params.has("empty") ? [] : properties}
      prefill={{ checkIn: params.get("checkIn") ?? "2027-11-27", checkOut: params.get("checkOut") ?? "2027-11-30" }}
      onClose={() => {}}
      onCreated={() => {}}
      onBlockInstead={() => {}}
    />
  );
}

const locale = params.get("lang") === "th" ? "th" : "en";

createRoot(document.getElementById("root")!).render(
  <IntlProvider
    locale={locale}
    timeZone="Asia/Bangkok"
    messages={{ Booking: (locale === "th" ? th : en).Booking }}
  >
    <ConfirmProvider><Fixture /></ConfirmProvider>
  </IntlProvider>,
);
