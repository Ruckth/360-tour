"use client";
import { api } from 'convex/_generated/api';

import { Mail, X } from "lucide-react";
import { useTranslations } from "@/platform/intl";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConvex } from 'convex/react';

export function LeadCapture({
  propertySlug,
  onClose,
}: {
  propertySlug: string;
  onClose: () => void;
}) {
  const tourT = useTranslations("Tour");
  const a11y = useTranslations("A11y");
  const convex = useConvex();
  const emailId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const submittingRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || pending) return;

    setError("");
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(tourT("invalidEmail"));
      return;
    }

    submittingRef.current = true;
    setPending(true);
    try {
      await convex.mutation(api.messaging.leads.save, {
        propertySlug,
        email: trimmed,
        source: "tour_completion",
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tourT("saveError"));
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-5 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full text-white/55 hover:bg-white/10 hover:text-white"
          aria-label={a11y("close")}
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
          <Mail className="h-5 w-5 text-gold" />
        </div>
        <h2 className="mt-5 font-serif text-3xl font-semibold">
          {tourT("leadTitle")}
        </h2>
        {submitted ? (
          <p className="mt-3 text-sm leading-relaxed text-white/70" role="status">
            {tourT("leadSaved")}
          </p>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} noValidate>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              {tourT("leadBody")}
            </p>
            <div className="mt-5 space-y-2">
              <Label htmlFor={emailId} className="text-sm font-medium text-white/85">
                {tourT("emailLabel")}
              </Label>
              <Input
                id={emailId}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={tourT("leadEmailPlaceholder")}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                disabled={pending}
                className="h-12 rounded-xl border-white/15 bg-white/10 text-white placeholder:text-white/35 focus-visible:ring-gold/40"
              />
            </div>
            {error ? (
              <p id={errorId} role="alert" className="mt-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="gold" disabled={pending} className="mt-4 w-full">
              {pending ? tourT("saving") : tourT("save")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
