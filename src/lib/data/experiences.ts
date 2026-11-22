import type { PublicMessages } from "@/lib/i18n/public-content";

export const experienceHeroImage = "/experiences/hero-samui-experiences.png";

export const experienceItems = [
  {
    id: "privateChef",
    image: "/experiences/private-chef-dining.png",
    icon: "utensils",
  },
  {
    id: "wellness",
    image: "/experiences/wellness-yoga.png",
    icon: "heart",
  },
  {
    id: "beachWater",
    image: "/experiences/beach-water-days.png",
    icon: "waves",
  },
  {
    id: "arrivalConcierge",
    image: "/experiences/arrival-concierge.png",
    icon: "car",
  },
] as const;

export const experienceSteps = [
  { id: "chooseVilla" },
  { id: "sharePreferences" },
  { id: "arriveEffortlessly" },
] as const;

/** `/experiences` metadata copy shared by the Next page and the Start route. */
export function experiencesSeo(messages: PublicMessages) {
  const seo = messages.SEO;
  return {
    title: seo.experiencesTitle,
    description: seo.experiencesDescription,
    ogTitle: seo.experiencesOgTitle,
    image: experienceHeroImage,
  };
}
