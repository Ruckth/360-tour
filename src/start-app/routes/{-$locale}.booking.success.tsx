import { createFileRoute } from "@tanstack/react-router";
import { BookingSuccessClient } from "@/components/booking/BookingSuccessClient";
import { PaymentLoading } from "@/components/loading/RouteLoading";
import { bookingAccessParams } from "@/lib/booking/page-params";
import { guestHead, guestLocaleContext, guestSearch } from "../guest/guest-route";

export const Route = createFileRoute("/{-$locale}/booking/success")({
  validateSearch: guestSearch,
  beforeLoad: guestLocaleContext,
  head: ({ matches }) => guestHead(matches, (messages) => ({ title: messages.SEO.successTitle })),
  pendingComponent: PaymentLoading,
  component: StartBookingSuccess,
});

function StartBookingSuccess() {
  const { bookingId, accessToken } = bookingAccessParams(Route.useSearch());
  return <BookingSuccessClient bookingId={bookingId} accessToken={accessToken} />;
}
