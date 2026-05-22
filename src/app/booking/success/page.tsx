import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { BookingSuccessClient } from "@/components/booking/BookingSuccessClient";
import { getPublicMessages } from "@/lib/i18n/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: getPublicMessages(locale).SEO.successTitle,
  };
}

export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string; booking_id?: string; token?: string; bookingToken?: string }>;
}) {
  const params = await searchParams;
  const bookingId = params.bookingId ?? params.booking_id ?? "demo";
  const accessToken = params.token ?? params.bookingToken ?? "";

  return <BookingSuccessClient bookingId={bookingId} accessToken={accessToken} />;
}
