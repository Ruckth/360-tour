"use client";

import * as React from "react";
import TextareaAutosize, {
  type TextareaAutosizeProps,
} from "react-textarea-autosize";
import { cn } from "@/lib/utils";

export const ChatInput = React.forwardRef<
  HTMLTextAreaElement,
  TextareaAutosizeProps
>(({ className, ...props }, ref) => (
  <TextareaAutosize
    ref={ref}
    autoComplete="off"
    name="message"
    minRows={1}
    maxRows={5}
    className={cn(
      "max-h-36 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-muted bg-muted/70 px-4 py-3 text-base leading-6 text-foreground shadow-sm transition placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:placeholder:text-slate-400 md:min-h-10 md:rounded-lg md:bg-background md:px-3 md:py-2 md:text-sm md:leading-5",
      className,
    )}
    {...props}
  />
));
ChatInput.displayName = "ChatInput";
