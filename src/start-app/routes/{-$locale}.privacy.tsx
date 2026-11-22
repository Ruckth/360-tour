import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { guestHead, guestLocaleContext } from "../guest/guest-route";

export const Route = createFileRoute("/{-$locale}/privacy")({
  beforeLoad: guestLocaleContext,
  head: ({ matches }) => guestHead(matches, (messages) => ({ title: messages.Legal.privacy.title })),
  component: () => <LegalPage kind="privacy" />,
});
