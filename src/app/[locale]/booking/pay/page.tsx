import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { ProposalPayClient } from "@/components/booking/ProposalPayClient";
import { PayClient } from "@/components/booking/PayClient";
import { quotedTotalFromParam } from "@/lib/booking/coupon";
import { getPublicMessages } from "@/lib/i18n/server-content";

type PaySearchParams = {
  proposal?: string;
  bookingId?: string;
  booking_id?: string;
  token?: string;
  bookingToken?: string;
  /** The total the booking funnel showed, so the pay page can flag a different booked total. */
  quoted?: string;
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

  if (params.proposal !== undefined) return <ProposalPayClient token={params.proposal} />;

  return <PayClient bookingId={bookingId} accessToken={accessToken} quotedTotal={quotedTotalFromParam(params.quoted)} />;
}
