import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { BookingSuccessClient } from "@/components/booking/BookingSuccessClient";
import { bookingAccessParams } from "@/lib/booking/page-params";
import type { PageSearch } from "@/lib/page-search";
import { getPublicMessages } from "@/lib/i18n/server-content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: getPublicMessages(locale).SEO.successTitle,
  };
}

export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  const { bookingId, accessToken } = bookingAccessParams(await searchParams);
  return <BookingSuccessClient bookingId={bookingId} accessToken={accessToken} />;
}
