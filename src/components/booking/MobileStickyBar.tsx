"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

export function MobileStickyBar({
  propertyId,
}: {
  propertyId: string;
}) {
  function openChat() {
    window.dispatchEvent(new CustomEvent("open-concierge-chat"));
  }

  return (
    <div className="fixed inset-x-4 bottom-3 z-40 md:hidden">
      <div className="mx-auto flex max-w-sm translate-y-1 items-center gap-2 rounded-full border border-border/80 bg-background/90 p-2 shadow-2xl shadow-black/25 backdrop-blur-xl transition-transform duration-300 focus-within:translate-y-0 hover:translate-y-0 dark:bg-card/90">
        <Link
          href={`/booking?unit=${propertyId}`}
          className="flex h-12 flex-1 items-center justify-center rounded-full bg-gold px-5 text-sm font-semibold text-navy shadow-lg shadow-gold/20 transition hover:bg-gold-light"
        >
          Book
        </Link>
        <button
          type="button"
          onClick={openChat}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted"
          aria-label="Open concierge chat"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
