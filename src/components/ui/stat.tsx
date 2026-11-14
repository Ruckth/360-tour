import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";
import { InfoTip } from "./info-tip";

/** A metric surface: short label, explanation on demand, value and one-line hint. */
export function Stat({ label, value, info, hint, hero = false, children, className, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: string;
  value: ReactNode;
  info: ReactNode;
  hint?: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card data-slot="stat" className={cn("grid min-w-0 content-start gap-2 p-4 sm:p-5", hero && "bg-card ring-1 ring-foreground/10", className)} {...props}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{label}</span>
        <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip>
      </div>
      <p className={cn("font-sans text-[28px] leading-tight font-semibold tabular-nums tracking-tight", hero && "text-[40px]")}>{value}</p>
      {hint ? <p className="text-balance text-[13px] text-muted-foreground" title={hint}>{hint}</p> : null}
      {children}
    </Card>
  );
}
