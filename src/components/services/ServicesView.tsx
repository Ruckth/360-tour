import Image from "@/platform/image";
import Link from "@/platform/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import { allowedImageUrl } from "convex/shared/imageUrls";
import { Button, ButtonLink } from "@/components/ui/button";
import { localizeHref, type Locale } from "@/i18n/routing";
import type { PublicMessages } from "@/lib/i18n/public-content";
import type { ServicesQuery } from "@/lib/services-query";
import { ServiceCardBooking } from "./ServiceCardBooking";

export type ServiceDirectory = FunctionReturnType<typeof api.services.publicServices.categories> | null;
export type ServiceResults = FunctionReturnType<typeof api.services.publicServices.list> | null;

/** Service catalog contents shared by the Next page and the Start route (no hooks). */
export function ServicesView({
  locale,
  t,
  query: { category, query, cursor, categoryAfter },
  directory,
  result,
}: {
  locale: Locale;
  t: PublicMessages["ServiceCatalog"];
  query: ServicesQuery;
  directory: ServiceDirectory;
  result: ServiceResults;
}) {
  const href = (values: Record<string, string | null | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({
      category,
      q: query,
      ...values,
    }))
      if (value) search.set(key, value);
    return localizeHref(`/services${search.size ? `?${search}` : ""}`, locale);
  };
  return (
    <main className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
      <div className="max-w-2xl">
        <h1 className="font-serif text-4xl font-semibold text-foreground md:text-5xl">
          {t.title}
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">{t.intro}</p>
      </div>
      <form
        action={localizeHref("/services", locale)}
        className="mt-8 flex flex-wrap items-end gap-3"
      >
        {category && <input type="hidden" name="category" value={category} />}
        <label className="grid flex-1 gap-2 text-sm font-medium">
          {t.search}
          <input
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder={t.searchPlaceholder}
            className="min-w-48 rounded-lg border border-border bg-background px-4 py-3 text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          />
        </label>
        <Button type="submit" size="lg">
          {t.search}
        </Button>
      </form>
      <nav aria-label={t.categories} className="mt-6 flex flex-wrap gap-2">
        <Link
          href={href({ category: null, cursor: null })}
          aria-current={!category ? "page" : undefined}
          className="rounded-full border border-border px-4 py-2 text-sm aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
        >
          {t.all}
        </Link>
        {directory?.categories.map((item) => (
          <Link
            key={item.name}
            href={href({ category: item.name, cursor: null })}
            aria-current={category === item.name ? "page" : undefined}
            className="rounded-full border border-border px-4 py-2 text-sm aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
          >
            {item.name}
          </Link>
        ))}
        {directory?.nextCategory && (
          <Link
            className="px-3 py-2 text-sm underline"
            href={href({ categoryAfter: directory.nextCategory })}
          >
            {t.moreCategories}
          </Link>
        )}
        {categoryAfter && (
          <Link
            className="px-3 py-2 text-sm underline"
            href={href({ categoryAfter: null })}
          >
            {t.first}
          </Link>
        )}
      </nav>
      {category && (
        <h2 className="mt-8 font-serif text-2xl font-semibold">{category}</h2>
      )}
      {!result ? (
        <p
          role="status"
          className="mt-10 rounded-lg border border-border p-6 text-muted-foreground"
        >
          {t.unavailable}
        </p>
      ) : result.page.length === 0 ? (
        <p
          role="status"
          className="mt-10 rounded-lg border border-border p-6 text-muted-foreground"
        >
          {t.empty}
        </p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {result.page.map((service) => (
            <article
              key={service.slug}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              {service.imageUrl && allowedImageUrl(service.imageUrl) && (
                <div className="relative aspect-[16/10] bg-muted">
                  <Image
                    src={service.imageUrl}
                    alt={service.name}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              )}
              <div className="flex flex-col gap-3 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {service.category}
                </p>
                <h3 className="font-serif text-2xl font-semibold">
                  {service.name}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {service.description}
                </p>
                <ServiceCardBooking service={service} locale={locale} t={t} />
              </div>
            </article>
          ))}
        </div>
      )}
      {result && (
        <div className="mt-8 flex flex-wrap gap-3">
          {cursor && (
            <ButtonLink href={href({ cursor: null })} variant="outline">
              {t.first}
            </ButtonLink>
          )}
          {!result.isDone && (
            <ButtonLink href={href({ cursor: result.continueCursor })}>
              {t.next}
            </ButtonLink>
          )}
        </div>
      )}
    </main>
  );
}
