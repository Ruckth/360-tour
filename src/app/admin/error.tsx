"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Wraps each admin page (inside the layout), so a failing view keeps the sidebar and can be retried.
export default function AdminViewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <section role="alert" className="w-full max-w-lg border border-border bg-card p-6 shadow-sm">
        <TriangleAlert aria-hidden="true" className="mb-4 size-6 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground">This view could not load</h2>
        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
          {error.message || "Check admin authorization and try again."}
        </p>
        <Button type="button" className="mt-5" onClick={reset}>
          <RotateCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      </section>
    </div>
  );
}
