"use client";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

type HomeSolidBookButtonProps = Omit<ButtonProps, "variant">;

export function HomeSolidBookButton({
  className,
  children,
  ...props
}: HomeSolidBookButtonProps) {
  return (
    <Button
      {...props}
      data-testid="home-book-solid-button"
      variant="ghost"
      className={cn(
        "h-12 w-full rounded-xl border border-gold bg-gold px-8 text-navy shadow-lg shadow-gold/20 transition-all hover:bg-gold-light md:h-11 md:w-auto",
        "dark:border-gold dark:bg-gold dark:text-navy dark:shadow-black/20 dark:hover:bg-gold-light",
        className,
      )}
    >
      {children}
    </Button>
  );
}
