"use client";

import { Mail, X } from "lucide-react";
import { useState } from "react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { useOptionalConvex } from "@/lib/react/convex";

export function LeadCapture({
  propertySlug,
  onClose,
}: {
  propertySlug: string;
  onClose: () => void;
}) {
  const convex = useOptionalConvex();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email.");
      return;
    }
    try {
      if (convex) {
        await convex.mutation(api.leads.save, {
          propertySlug,
          email,
          source: "tour_completion",
        } as never);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this email.");
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-5 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-white/55 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
          <Mail className="h-5 w-5 text-gold" />
        </div>
        <h2 className="mt-5 font-serif text-3xl font-semibold">
          Save this dream
        </h2>
        {submitted ? (
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Saved. We’ll keep this villa warm in your inbox with direct booking details.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Get the direct booking link and a reminder of the villa you just explored.
            </p>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-5 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-sm text-white outline-none focus:border-gold"
            />
            {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
            <Button variant="gold" className="mt-4 w-full" onClick={submit}>
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
