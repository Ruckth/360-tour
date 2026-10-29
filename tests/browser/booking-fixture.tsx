import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { BookingSheet } from "@/components/admin/BookingSheet";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { useState } from "react";
import { NewAppointmentDialog } from "@/components/admin/NewAppointmentDialog";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
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
    pricePerNight: 8500,
    currency: "THB",
    directDiscountPercent: 15,
  },
  {
    _id: "garden-id" as Id<"properties">,
    slug: "garden-villa",
    name: "Garden Villa",
    maxGuests: 4,
    status: "active",
    pricePerNight: 4200,
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
  price: 1000,
  currency: "THB",
  staffIds: [],
  status: "active",
  imageUrl: index === 0 ? photo : undefined,
}));

function Fixture() {
  const [filter, setFilter] = useState("all");
  if (params.get("mode") === "public-calendar") return (
    <BookingRangePicker checkIn="2025-02-14" checkOut="2025-02-17" onChange={() => {}}
      unavailableDates={["2025-02-15"]} isDateDisabled={() => true} />
  );
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

createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Bangkok"
    messages={{ Booking: { checkIn: "Check in", checkOut: "Check out" } }}
  >
    <Fixture />
  </NextIntlClientProvider>,
);
