import { createFileRoute } from "@tanstack/react-router";
import { BookingFunnel } from "@/components/booking/BookingFunnel";
import { BookingLoading } from "@/components/loading/RouteLoading";
import { bookingFunnelProps } from "@/lib/booking/page-params";
import { guestHead, guestLocaleContext, guestSearch } from "../guest/guest-route";

export const Route = createFileRoute("/{-$locale}/booking/")({
  validateSearch: guestSearch,
  beforeLoad: guestLocaleContext,
  head: ({ matches }) => guestHead(matches, (messages) => ({ title: messages.SEO.bookingTitle })),
  pendingComponent: BookingLoading,
  component: StartBooking,
});

function StartBooking() {
  return <BookingFunnel {...bookingFunnelProps(Route.useSearch())} />;
}
