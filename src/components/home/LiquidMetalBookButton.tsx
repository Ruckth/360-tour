"use client";

import { MetalFx, type MetalFxTheme } from "metal-fx";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

type LiquidMetalBookButtonProps = Omit<ButtonProps, "variant">;

function getCurrentMetalTheme(): MetalFxTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function supportsWebGL() {
  if (typeof document === "undefined") return false;

  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl"));
}

export function LiquidMetalBookButton({
  className,
  children,
  ...props
}: LiquidMetalBookButtonProps) {
  const [canRenderMetal, setCanRenderMetal] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [theme, setTheme] = useState<MetalFxTheme>("light");

  useEffect(() => {
    setTheme(getCurrentMetalTheme());
    setCanRenderMetal(supportsWebGL());

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => setReduceMotion(reducedMotionQuery.matches);
    updateReducedMotion();

    const observer = new MutationObserver(() => {
      setTheme(getCurrentMetalTheme());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    reducedMotionQuery.addEventListener("change", updateReducedMotion);

    return () => {
      observer.disconnect();
      reducedMotionQuery.removeEventListener("change", updateReducedMotion);
    };
  }, []);

  const button = (
    <Button
      {...props}
      variant="gold"
      className={cn("h-12 w-full rounded-xl px-8 md:h-11 md:w-auto", className)}
    >
      {children}
    </Button>
  );

  if (!canRenderMetal) {
    return button;
  }

  return (
    <div
      data-testid="home-book-metal-fx"
      data-theme={theme}
      className="block w-full rounded-xl md:inline-block md:w-auto"
    >
      <MetalFx
        variant="button"
        preset="gold"
        theme={theme}
        strength={theme === "dark" ? 0.88 : 0.78}
        paused={reduceMotion}
        borderRadius={12}
        normalizeHostStyles={false}
        className="block w-full rounded-xl md:inline-block md:w-auto"
      >
        {button}
      </MetalFx>
    </div>
  );
}
