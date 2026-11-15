import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none text-foreground", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";

/** Muted field label shared by settings and marketing forms. */
export function FieldLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <Label {...props} className={cn("text-xs font-normal text-muted-foreground", props.className)} />;
}
