"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Wraps each admin page (inside the layout), so a failing view keeps the sidebar and can be retried.
export default function AdminViewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <section role="alert" className="max-w-lg border border-border bg-card p-7 shadow-xl">
        <TriangleAlert aria-hidden="true" className="mb-5 h-8 w-8 text-destructive" />
        <h2 className="font-serif text-3xl font-semibold">Unable to load this view</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error.message || "Check admin authorization and try again."}
        </p>
        <Button type="button" className="mt-6" onClick={reset}>
          <RotateCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </Button>
      </section>
    </div>
  );
}
