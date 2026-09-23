import * as React from "react";
import { cn } from "@/lib/utils";

type ChatBubbleVariant = "received" | "sent";

export const ChatBubble = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: ChatBubbleVariant }
>(({ className, variant = "received", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "group relative flex max-w-[90%] items-end gap-2 sm:max-w-[85%]",
      variant === "sent" ? "ml-auto flex-row-reverse" : "mr-auto",
      className,
    )}
    {...props}
  />
));
ChatBubble.displayName = "ChatBubble";

export function ChatBubbleAvatar({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-semibold text-foreground"
    >
      {label}
    </span>
  );
}

export const ChatBubbleMessage = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: ChatBubbleVariant;
    isLoading?: boolean;
    loadingLabel?: string;
  }
>(
  (
    {
      className,
      variant = "received",
      isLoading,
      loadingLabel,
      children,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      role={isLoading ? "status" : undefined}
      aria-label={isLoading ? loadingLabel : undefined}
      className={cn(
        "min-w-0 max-w-full break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
        variant === "sent"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
        className,
      )}
      {...props}
    >
      {isLoading ? (
        <>
          <span className="sr-only">{loadingLabel}</span>
          <span className="flex items-center gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-2 w-2 animate-bounce rounded-full bg-current"
                style={{ animationDelay: `${index * 140}ms` }}
              />
            ))}
          </span>
        </>
      ) : (
        children
      )}
    </div>
  ),
);
ChatBubbleMessage.displayName = "ChatBubbleMessage";

export function ChatBubbleTimestamp({
  className,
  ...props
}: React.HTMLAttributes<HTMLTimeElement>) {
  return (
    <time
      className={cn(
        "mt-1 block text-right text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
