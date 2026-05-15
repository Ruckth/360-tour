import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function StarRating({
  rating,
  reviewCount,
  size = "sm",
  showValue = false,
}: {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  showValue?: boolean;
}) {
  const iconClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5 text-gold">
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={index}
            className={cn(iconClass, index < Math.round(rating) && "fill-current")}
          />
        ))}
      </div>
      {showValue ? (
        <span className="text-xs font-medium text-muted-foreground md:text-sm">
          {rating.toFixed(2)}{reviewCount ? ` (${reviewCount})` : ""}
        </span>
      ) : null}
    </div>
  );
}
