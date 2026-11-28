"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "@/platform/intl";
import { bookingSteps, type BookingStep } from "@/lib/booking/booking";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BookingStepNav({
  currentStep,
  highestAllowedStepIndex,
  onSelectStep,
}: {
  currentStep: BookingStep;
  highestAllowedStepIndex: number;
  onSelectStep: (step: BookingStep) => void;
}) {
  const t = useTranslations("Booking");
  const activeStep = useRef<HTMLButtonElement>(null);
  const previousStep = useRef(currentStep);

  useEffect(() => {
    if (previousStep.current === currentStep) return;
    previousStep.current = currentStep;
    activeStep.current?.focus({ preventScroll: true });
    activeStep.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [currentStep]);
  const currentIndex = bookingSteps.findIndex((item) => item.key === currentStep);
  const labels: Record<BookingStep, string> = {
    select: t("villaDates"),
    info: t("guestDetails"),
    review: t("pay"),
  };

  return (
    <div className="mb-6 grid grid-cols-3 gap-2">
      {bookingSteps.map((item, index) => {
        const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
        return (
          <Button
            key={item.key}
            type="button"
            variant={state === "current" ? "primary" : state === "complete" ? "outline" : "secondary"}
            ref={state === "current" ? activeStep : undefined}
            aria-current={state === "current" ? "step" : undefined}
            data-step-state={state}
            disabled={index > highestAllowedStepIndex}
            onClick={() => onSelectStep(item.key)}
            className={cn(
              "min-h-11 scroll-mt-24 gap-1.5 whitespace-normal px-2 py-2 text-xs md:text-sm",
              state === "complete" && "border-primary/40 text-foreground",
              state === "upcoming" && "bg-muted text-muted-foreground hover:bg-muted",
              index > highestAllowedStepIndex && "cursor-not-allowed opacity-55",
            )}
          >
            {state === "complete" ? (
              <>
                <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="sr-only">{t("stepCompleted")} </span>
              </>
            ) : null}
            {labels[item.key]}
          </Button>
        );
      })}
    </div>
  );
}
