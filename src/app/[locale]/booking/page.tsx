import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { BookingFunnel } from "@/components/booking/BookingFunnel";
import { bookingFunnelProps } from "@/lib/booking/page-params";
import type { PageSearch } from "@/lib/page-search";
import { getPublicMessages } from "@/lib/i18n/server-content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: getPublicMessages(locale).SEO.bookingTitle,
  };
}

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  return <BookingFunnel {...bookingFunnelProps(await searchParams)} />;
}
