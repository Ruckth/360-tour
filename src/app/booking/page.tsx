import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { BookingFunnel } from "@/components/booking/BookingFunnel";
import { getPublicMessages } from "@/lib/i18n/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: getPublicMessages(locale).SEO.bookingTitle,
  };
}

type BookingSearchParams = Record<string, string | string[] | undefined>;

function getParam(params: BookingSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<BookingSearchParams>;
}) {
  const params = await searchParams;

  return (
    <BookingFunnel
      initialCheckIn={getParam(params, "checkin")}
      initialCheckOut={getParam(params, "checkout")}
      initialNights={getParam(params, "nights")}
      initialGuests={getParam(params, "guests")}
      initialAdults={getParam(params, "adults")}
      initialChildren={getParam(params, "children")}
      initialProperty={getParam(params, "unit") ?? getParam(params, "property")}
    />
  );
}
