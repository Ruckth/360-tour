import Image from "next/image";
import { StarRating } from "@/components/social/StarRating";
import type { Review } from "@/lib/data/reviews";

export function ReviewCarousel({ reviews }: { reviews: Review[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {reviews.slice(0, 6).map((review) => (
        <article
          key={review.id}
          className="rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <Image
              src={review.author.avatarUrl}
              alt={review.author.name}
              width={44}
              height={44}
              className="rounded-full object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {review.author.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {review.author.city}, {review.author.country}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <StarRating rating={review.rating} />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {review.title}
          </h3>
          <p className="mt-2 line-clamp-5 text-sm leading-relaxed text-muted-foreground">
            {review.body}
          </p>
        </article>
      ))}
    </div>
  );
}
