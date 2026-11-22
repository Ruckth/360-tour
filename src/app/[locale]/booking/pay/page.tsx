import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { ProposalPayClient } from "@/components/booking/ProposalPayClient";
import { PayClient } from "@/components/booking/PayClient";
import { payPageProps } from "@/lib/booking/page-params";
import type { PageSearch } from "@/lib/page-search";
import { getPublicMessages } from "@/lib/i18n/server-content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: getPublicMessages(locale).SEO.payTitle,
  };
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  const props = payPageProps(await searchParams);
  if (props.kind === "proposal") return <ProposalPayClient token={props.token} />;
  return <PayClient bookingId={props.bookingId} accessToken={props.accessToken} quotedTotal={props.quotedTotal} />;
}
