import { createFileRoute } from "@tanstack/react-router";
import { ExperiencesView } from "@/components/experiences/ExperiencesView";
import { experiencesSeo } from "@/lib/data/experiences";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { guestHead, guestLocaleContext } from "../guest/guest-route";

export const Route = createFileRoute("/{-$locale}/experiences")({
  beforeLoad: guestLocaleContext,
  head: ({ matches }) => guestHead(matches, (messages) => {
    const seo = experiencesSeo(messages);
    return {
      title: seo.title,
      description: seo.description,
      social: { title: seo.ogTitle, description: seo.description, image: seo.image },
    };
  }),
  component: StartExperiences,
});

function StartExperiences() {
  const { guestLocale } = Route.useRouteContext();
  return <ExperiencesView locale={guestLocale} publicMessages={usePublicMessages()} />;
}
