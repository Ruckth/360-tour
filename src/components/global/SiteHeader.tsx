"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/global/LanguageSwitcher";
import { ThemeToggle } from "@/components/global/ThemeToggle";
import { defaultLocale, isLocale, localizeHref, stripLocalePrefix } from "@/i18n/routing";
import { resort } from "@/lib/data/resort-config";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/#villas", labelKey: "villas" },
  { href: "/#amenities", labelKey: "amenities" },
  { href: "/#reviews", labelKey: "reviews" },
  { href: "/#contact", labelKey: "contact" },
] as const;

export function SiteHeader() {
  const t = useTranslations("Nav");
  const a11y = useTranslations("A11y");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isHome = stripLocalePrefix(pathname) === "/";
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
        <Link
          href={localizeHref("/", locale)}
          className="flex items-center gap-2"
          onClick={() => setMobileMenuOpen(false)}
        >
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
              href={localizeHref(link.href, locale)}
              className={cn(
                "text-sm font-medium transition-colors",
                solid
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-white/70 hover:text-white",
              )}
            >
              {t(link.labelKey)}
            </Link>
          ))}
          <ButtonLink href={localizeHref("/booking", locale)} size="nav" variant={solid ? "primary" : "glass"}>
            {t("book")}
          </ButtonLink>
          <LanguageSwitcher solid={solid} />
          <ThemeToggle solid={solid} />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher solid={solid} compact />
          <ThemeToggle solid={solid} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen((value) => !value)}
            className={cn(
              "h-9 w-9 rounded-full hover:bg-transparent",
              solid ? "text-foreground" : "text-white",
            )}
            aria-label={a11y("toggleMenu")}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {mobileMenuOpen ? (
        <div className="border-t border-border bg-background/98 backdrop-blur-md md:hidden">
          <div className="flex flex-col space-y-1 px-5 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={localizeHref(link.href, locale)}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                {t(link.labelKey)}
              </Link>
            ))}
            <ButtonLink
              href={localizeHref("/booking", locale)}
              size="nav"
              className="mt-2 w-full justify-center"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t("book")}
            </ButtonLink>
          </div>
        </div>
      ) : null}
    </header>
  );
}
