"use client";

import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const ChatMessageList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { contentKey?: string | number }
>(({ className, children, contentKey, onScroll, ...props }, forwardedRef) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const pinnedRef = React.useRef(true);

  React.useImperativeHandle(forwardedRef, () => scrollRef.current!);

  const scrollToBottom = React.useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setAtBottom(true);
  }, []);

  React.useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [contentKey]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node.firstElementChild ?? node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        {...props}
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const nextAtBottom =
            node.scrollHeight - node.scrollTop - node.clientHeight < 96;
          pinnedRef.current = nextAtBottom;
          setAtBottom(nextAtBottom);
          onScroll?.(event);
        }}
        className={cn("h-full overflow-y-auto", className)}
      >
        <div className="flex flex-col gap-3">{children}</div>
      </div>
      {!atBottom ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="absolute bottom-2 left-1/2 h-9 w-9 -translate-x-1/2 rounded-full shadow-md"
          aria-label="Scroll to bottom"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
});
ChatMessageList.displayName = "ChatMessageList";
