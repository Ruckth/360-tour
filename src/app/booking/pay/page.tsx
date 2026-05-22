import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { PayClient } from "@/components/booking/PayClient";
import { getPublicMessages } from "@/lib/i18n/public-content";

type PaySearchParams = {
  bookingId?: string;
  booking_id?: string;
  token?: string;
  bookingToken?: string;
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: getPublicMessages(locale).SEO.payTitle,
  };
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<PaySearchParams>;
}) {
  const params = await searchParams;
  const bookingId = params.bookingId ?? params.booking_id ?? "demo";
  const accessToken = params.token ?? params.bookingToken ?? "";

  return <PayClient bookingId={bookingId} accessToken={accessToken} />;
}
