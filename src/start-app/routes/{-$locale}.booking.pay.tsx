import { createFileRoute } from "@tanstack/react-router";
import { PayClient } from "@/components/booking/PayClient";
import { ProposalPayClient } from "@/components/booking/ProposalPayClient";
import { PaymentLoading } from "@/components/loading/RouteLoading";
import { payPageProps } from "@/lib/booking/page-params";
import { guestHead, guestLocaleContext, guestSearch } from "../guest/guest-route";

export const Route = createFileRoute("/{-$locale}/booking/pay")({
  validateSearch: guestSearch,
  beforeLoad: guestLocaleContext,
  head: ({ matches }) => guestHead(matches, (messages) => ({ title: messages.SEO.payTitle })),
  pendingComponent: PaymentLoading,
  component: StartPay,
});

function StartPay() {
  const props = payPageProps(Route.useSearch());
  if (props.kind === "proposal") return <ProposalPayClient token={props.token} />;
  return <PayClient bookingId={props.bookingId} accessToken={props.accessToken} quotedTotal={props.quotedTotal} />;
}
