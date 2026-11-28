"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import { BedDouble, MessageCircle } from "lucide-react";
import Link from "@/platform/link";
import { staffDate } from "@/lib/staff-time";
import { resortMidnight } from "@/lib/staff-bookings";
import { useDebounced } from "./admin-bulk";
import { guestLabel } from "./labels";
import { useStaffAccess } from "./staff-access";

const SHOWN = 5;

/** The Hotel link that opens one stay's sheet (see AdminBookingsView). */
export function stayHref(bookingId: string) {
  return `/admin/hotel?booking=${encodeURIComponent(bookingId)}`;
}

/**
 * Stays and chats matching the admin Search text, beside the page results. Each source is the
 * page's own server search (searchBookings, listSessions) under its access check, and runs only
 * when this person's capabilities open that page. A result is shown only for the text it was
 * fetched for, so a slower earlier response never replaces newer results.
 */
export function AdminRecordSearch({ query, onOpen }: { query: string; onOpen: () => void }) {
  const { capabilities } = useStaffAccess();
  const text = useDebounced(query.trim(), 300);
  const ready = text.length >= 2 && text === query.trim();
  const stays = useQuery(api.bookings.admin.searchBookings, ready && capabilities.bookings ? { query: text } : "skip");
  const chats = useQuery(
    api.messaging.adminChat.listSessions,
    ready && capabilities.chats ? { searchQuery: text, status: "all", adminStatus: "all", paginationOpts: { numItems: SHOWN, cursor: null } } : "skip",
  );
  if (!ready) return null;
  const stayRows = stays?.slice(0, SHOWN) ?? [];
  const chatRows = chats?.sessions.slice(0, SHOWN) ?? [];
  const loading = (capabilities.bookings && stays === undefined) || (capabilities.chats && chats === undefined);
  if (!loading && stayRows.length === 0 && chatRows.length === 0) return null;
  const linkClass = "flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";
  return (
    <div role="group" aria-label="Matching records" className="grid gap-2 px-2 pb-2">
      {loading ? <p role="status" className="px-2 text-xs text-sidebar-foreground/70">Searching records…</p> : null}
      {stayRows.length ? (
        <section aria-label="Stays" className="grid">
          <h3 className="px-2 text-xs font-medium text-sidebar-foreground/70">Stays</h3>
          {stayRows.map((stay) => (
            <Link key={stay._id} href={stayHref(stay._id)} className={linkClass} onClick={onOpen}>
              <BedDouble aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{stay.guestName}</span>
              <span className="shrink-0 text-xs text-sidebar-foreground/70">{staffDate(resortMidnight(stay.checkIn))}</span>
            </Link>
          ))}
        </section>
      ) : null}
      {chatRows.length ? (
        <section aria-label="Chats" className="grid">
          <h3 className="px-2 text-xs font-medium text-sidebar-foreground/70">Chats</h3>
          {chatRows.map((chat) => (
            <Link key={chat._id} href={`/admin/chats?session=${chat._id}`} className={linkClass} onClick={onOpen}>
              <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{chat.visitorName || chat.visitorEmail || chat.visitorPhone || guestLabel(chat.channel)}</span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
