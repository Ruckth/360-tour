"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/global/ThemeToggle";
import { resort } from "@/lib/data/resort-config";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/#villas", label: "Villas" },
  { href: "/#amenities", label: "Amenities" },
  { href: "/#reviews", label: "Reviews" },
  { href: "/#contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isHome = pathname === "/";
  const solid = scrolled || !isHome || mobileMenuOpen;

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        solid
          ? "border-b border-border bg-background/95 shadow-sm backdrop-blur-md"
          : "bg-transparent",
      )}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8 md:py-4">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
          <span
            className={cn(
              "font-serif text-xl font-semibold tracking-tight md:text-2xl",
              solid ? "text-foreground" : "text-white",
            )}
          >
            {resort.name}
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm font-medium transition-colors",
                solid
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-white/70 hover:text-white",
              )}
            >
              {link.label}
            </Link>
          ))}
          <ButtonLink href="/booking" size="nav" variant={solid ? "primary" : "glass"}>
            Book
          </ButtonLink>
          <ThemeToggle solid={solid} />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle solid={solid} />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((value) => !value)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full",
              solid ? "text-foreground" : "text-white",
            )}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {mobileMenuOpen ? (
        <div className="border-t border-border bg-background/98 backdrop-blur-md md:hidden">
          <div className="flex flex-col space-y-1 px-5 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                {link.label}
              </Link>
            ))}
            <ButtonLink
              href="/booking"
              size="nav"
              className="mt-2 w-full justify-center"
              onClick={() => setMobileMenuOpen(false)}
            >
              Book
            </ButtonLink>
          </div>
        </div>
      ) : null}
    </header>
  );
}
