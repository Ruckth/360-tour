import Link from "next/link";
import { resort } from "@/lib/data/resort-config";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-[1fr_auto] md:px-8">
        <div>
          <p className="font-serif text-2xl font-semibold text-foreground">
            {resort.name}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {resort.tagline}. {resort.location}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            {resort.address}
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground md:text-right">
          <Link className="transition hover:text-foreground" href="/#villas">
            Villas
          </Link>
          <Link className="transition hover:text-foreground" href="/booking">
            Book Direct
          </Link>
          <a className="transition hover:text-foreground" href={`mailto:${resort.contactEmail}`}>
            {resort.contactEmail}
          </a>
        </div>
      </div>
    </footer>
  );
}
