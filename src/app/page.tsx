import Image from "next/image";
import { Anchor, Bell, Car, Check, Heart, Sparkles, Sun, Utensils, Waves } from "lucide-react";
import { HomeHero } from "@/components/home/HomeHero";
import { VillaCard } from "@/components/home/VillaCard";
import { ReviewCarousel } from "@/components/social/ReviewCarousel";
import { ButtonLink } from "@/components/ui/Button";
import { properties } from "@/lib/data/properties";
import { resort } from "@/lib/data/resort-config";
import { getSocialProofByPropertyId } from "@/lib/data/social-proof";
import { getPropertyTagline } from "@/lib/data/stories";

const amenityIcons = {
  waves: Waves,
  sparkles: Sparkles,
  utensils: Utensils,
  car: Car,
  bell: Bell,
  sun: Sun,
  heart: Heart,
  anchor: Anchor,
};

export default function HomePage() {
  const reviews = properties
    .flatMap((property) => getSocialProofByPropertyId(property.id)?.reviews ?? [])
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6);

  return (
    <>
      <HomeHero />

      <section id="about" className="py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              Welcome
            </p>
            <h1 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              A Sanctuary Above the Sea
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:mt-6 md:text-base">
              {resort.description}
            </p>
          </div>
          <div className="mt-14 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
            {resort.highlights.map((highlight) => (
              <div key={highlight.label} className="text-center">
                <p className="font-serif text-3xl font-semibold text-foreground md:text-4xl">
                  {highlight.stat}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground md:text-sm">
                  {highlight.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="villas" className="bg-muted/40 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mb-12 text-center md:mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              Accommodations
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              Our Villas
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
              Three distinct experiences, each with immersive 360° virtual tours.
            </p>
          </div>
          <div className="grid gap-6 md:gap-8 lg:grid-cols-2 lg:gap-10 2xl:grid-cols-3">
            {properties.map((property) => (
              <VillaCard
                key={property.id}
                property={property}
                socialProof={getSocialProofByPropertyId(property.id)}
                storyTagline={getPropertyTagline(property.id)}
              />
            ))}
          </div>
        </div>
      </section>

      <section id="amenities" className="py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              Experience
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              Resort Amenities
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
              Everything you need for an unforgettable stay, included with every villa.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {resort.amenities.map((amenity) => {
              const Icon = amenityIcons[amenity.icon as keyof typeof amenityIcons] ?? Sparkles;
              return (
                <div
                  key={amenity.name}
                  className="rounded-xl border border-border bg-card p-5 text-center transition hover:shadow-md md:p-6"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
                    <Icon className="h-5 w-5 text-gold" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">
                    {amenity.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="reviews" className="bg-muted/40 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              Testimonials
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              What Our Guests Say
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
              Real reviews from guests who experienced {resort.name}.
            </p>
          </div>
          <ReviewCarousel reviews={reviews} />
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
                Location
              </p>
              <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl">
                {resort.location}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
                Perched on the hillside overlooking the Gulf of Thailand,
                {` ${resort.name} `}is minutes from pristine beaches, world-class
                diving, and vibrant local markets. Yet once inside our gates,
                the world falls away.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "5 min to Bophut Beach",
                  "15 min from Samui Airport",
                  "10 min to Fisherman's Village",
                  "Private airport transfer included",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-foreground">
                    <Check className="h-4 w-4 flex-shrink-0 text-gold" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative min-h-[320px] overflow-hidden rounded-2xl">
              <Image
                src="https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=800&h=600&fit=crop"
                alt={`${resort.location} aerial view`}
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="bg-navy py-20 text-white dark:bg-card md:py-28">
        <div className="mx-auto max-w-3xl px-5 text-center md:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">
            Begin Your Stay
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold text-white md:text-4xl lg:text-5xl">
            Ready to Experience {resort.name}?
          </h2>
          <p className="mt-4 text-sm text-white/70 md:text-lg">
            Book direct and save 15% compared to online travel agencies. Includes
            complimentary airport transfer and welcome amenities.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center md:mt-10 md:gap-4">
            <ButtonLink href="/booking" variant="gold" className="w-full sm:w-auto">
              Book
            </ButtonLink>
            <a
              href={`mailto:${resort.contactEmail}`}
              className="inline-flex w-full items-center justify-center rounded-lg border border-white/25 px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
