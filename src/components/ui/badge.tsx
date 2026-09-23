import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        gold: "border-transparent bg-gold text-navy",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Secondary pill with an "×" button, for active filters and removable selections. */
export function RemovableBadge({
  children,
  className,
  removeLabel,
  onRemove,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  removeLabel: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <Badge variant="secondary" className={cn("gap-1 rounded-full", className)}>
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-background disabled:pointer-events-none"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

export { badgeVariants };
