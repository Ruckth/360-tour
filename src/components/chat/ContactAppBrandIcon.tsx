"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type ContactAppBrand = "whatsapp" | "line" | "facebook" | "instagram";

export function ContactAppBrandIcon({
  app,
  className,
  iconClassName,
  ...props
}: {
  app: ContactAppBrand;
  className?: string;
  iconClassName?: string;
} & Omit<ComponentPropsWithoutRef<"span">, "children">) {
  if (app === "whatsapp") {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0a9f6a] text-white", className)}
        {...props}
      >
        <svg className={cn("h-3.5 w-3.5", iconClassName)} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.04 2a9.93 9.93 0 0 0-8.5 15.07L2.2 22l5.05-1.31A9.93 9.93 0 1 0 12.04 2Zm0 1.7a8.23 8.23 0 1 1-4.18 15.32l-.32-.19-2.9.75.78-2.82-.21-.34A8.23 8.23 0 0 1 12.04 3.7Zm-3.6 4.1c-.18 0-.47.07-.72.34-.25.28-.94.93-.94 2.26 0 1.34.97 2.63 1.1 2.81.14.18 1.88 3.01 4.65 4.1 2.31.91 2.78.73 3.28.68.5-.04 1.61-.66 1.84-1.3.23-.63.23-1.18.16-1.3-.07-.11-.25-.18-.53-.32-.28-.14-1.62-.8-1.87-.89-.25-.09-.44-.14-.62.14-.18.27-.71.88-.87 1.06-.16.18-.32.21-.6.07-.28-.14-1.17-.43-2.23-1.38-.83-.74-1.38-1.65-1.55-1.93-.16-.28-.02-.43.12-.57.13-.13.28-.32.42-.48.14-.17.19-.28.28-.47.09-.18.04-.35-.02-.49-.07-.14-.62-1.49-.85-2.03-.22-.52-.45-.45-.62-.46h-.53Z" />
        </svg>
      </span>
    );
  }

  if (app === "facebook") {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1877f2] text-white", className)}
        {...props}
      >
        <svg className={cn("h-3.5 w-3.5", iconClassName)} viewBox="0 0 24 24" fill="currentColor">
          <path d="M13.6 22v-8.2h2.75l.42-3.2H13.6V8.56c0-.93.26-1.56 1.59-1.56h1.7V4.13c-.29-.04-1.3-.13-2.48-.13-2.45 0-4.13 1.5-4.13 4.25v2.37H7.5v3.2h2.78V22h3.32Z" />
        </svg>
      </span>
    );
  }

  if (app === "instagram") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f9ce34,#ee2a7b_50%,#6228d7)] text-white",
          className,
        )}
        {...props}
      >
        <svg className={cn("h-3.5 w-3.5", iconClassName)} viewBox="0 0 24 24" fill="none">
          <rect x="5" y="5" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
          <circle cx="16.5" cy="7.5" r="1.1" fill="currentColor" />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#06c755] text-white", className)}
      {...props}
    >
      <svg className={cn("h-4 w-4", iconClassName)} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.4 4.8A9.62 9.62 0 0 0 12 1.5C6.7 1.5 2.4 5 2.4 9.32c0 3.88 3.45 7.13 8.1 7.73.32.07.75.22.86.5.1.25.06.65.03.91l-.14.86c-.04.25-.2.99.84.54 1.03-.44 5.56-3.28 7.58-5.61a6.95 6.95 0 0 0 1.93-4.93c0-1.66-.42-3.2-1.2-4.52ZM8.13 11.92H5.74a.37.37 0 0 1-.37-.37V7.83a.37.37 0 1 1 .74 0v3.35h2.02a.37.37 0 1 1 0 .74Zm1.44-.37a.37.37 0 1 1-.74 0V7.83a.37.37 0 1 1 .74 0v3.72Zm4.52 0a.37.37 0 0 1-.67.22l-1.9-2.58v2.36a.37.37 0 1 1-.74 0V7.83a.37.37 0 0 1 .67-.22l1.9 2.58V7.83a.37.37 0 1 1 .74 0v3.72Zm2.99-1.86a.37.37 0 1 1 0 .74h-1.65v.75h1.65a.37.37 0 1 1 0 .74h-2.02a.37.37 0 0 1-.37-.37V7.83c0-.2.17-.37.37-.37h2.02a.37.37 0 1 1 0 .74h-1.65v.75h1.65Z" />
      </svg>
    </span>
  );
}
