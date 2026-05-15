import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "glass" | "ghost" | "gold";
type Size = "sm" | "md" | "lg" | "nav" | "icon";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
  outline:
    "border-border bg-background text-foreground hover:bg-muted",
  glass:
    "border-white/10 bg-white/15 text-white backdrop-blur-md hover:bg-white/25",
  ghost: "text-foreground hover:bg-muted",
  gold: "bg-gold text-navy shadow-lg shadow-gold/20 hover:bg-gold-light",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-2 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-sm md:text-base",
  nav: "h-9 px-4 text-sm",
  icon: "h-10 w-10 p-0",
};

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent font-semibold transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-45";

export function Button({
  className,
  variant = "primary",
  size = "md",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      className={cn(base, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  children,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(base, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {children}
    </Link>
  );
}
