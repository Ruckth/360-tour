"use client";

import { api } from "convex/_generated/api";
import { Component, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { BedDouble, CalendarClock, MessageCircle } from "lucide-react";
import Link from "@/platform/link";
import { staffCalendarHref } from "@/lib/staff-links";
import { staffDate, staffTime } from "@/lib/staff-time";
import { resortIsoDate, resortMidnight } from "@/lib/staff-bookings";
import { useDebounced } from "./admin-bulk";
import { guestLabel } from "./labels";
import { canOpenResortDesk } from "./admin-access";
import { useStaffAccess } from "./staff-access";

const SHOWN = 5;

/** The Hotel link that opens one stay's sheet (see AdminBookingsView). */
export function stayHref(bookingId: string) {
  return `/admin/hotel?booking=${encodeURIComponent(bookingId)}`;
}

/**
 * Stays, chats and appointments matching admin Search. Each source uses the destination
 * domain’s own bounded search and server authorization, and runs only
 * when this person's capabilities open that page. A result is shown only for the text it was
 * fetched for, so a slower earlier response never replaces newer results.
 */
export function AdminRecordSearch({ query, onOpen }: { query: string; onOpen: () => void }) {
  const access = useStaffAccess();
  const canOpenHotel = canOpenResortDesk(access, "bookings");
  const canOpenChats = canOpenResortDesk(access, "chats");
  const canOpenSpa = access.capabilities.services;
  const text = useDebounced(query.trim(), 300);
  const ready = text.length >= 2 && text.length <= 100 && text === query.trim();
  if (!ready) return null;
  return (
    <div role="group" aria-label="Matching records" className="grid gap-2 px-2 pb-2 empty:hidden">
      {canOpenHotel && <SearchSource key={`stays:${text}`} label="Stays"><StayResults text={text} onOpen={onOpen} /></SearchSource>}
      {canOpenChats && <SearchSource key={`chats:${text}`} label="Chats"><ChatResults text={text} onOpen={onOpen} /></SearchSource>}
      {canOpenSpa && <SearchSource key={`appointments:${text}`} label="Appointments"><AppointmentResults text={text} onOpen={onOpen} /></SearchSource>}
    </div>
  );
}

class SearchSource extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const { label, children } = this.props;
    if (!this.state.failed) return children;
    return (
      <section aria-label={label} className="grid gap-1 px-2 text-xs">
        <p role="alert">Could not search {label.toLowerCase()}.</p>
        <button type="button" className="min-h-9 justify-self-start underline" onClick={() => this.setState({ failed: false })}>
          Retry {label.toLowerCase()} search
        </button>
      </section>
    );
  }
}

type ResultProps = { text: string; onOpen: () => void };

function SearchLoading({ label }: { label: string }) {
  return <p role="status" className="px-2 text-xs text-sidebar-foreground/70">Searching {label}…</p>;
}

const linkClass = "flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function StayResults({ text, onOpen }: ResultProps) {
  const result = useQuery(api.bookings.admin.searchBookings, { query: text });
  if (result === undefined) return <SearchLoading label="stays" />;
  const stayRows = result.slice(0, SHOWN);
  return stayRows.length ? (
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
  ) : null;
}

function ChatResults({ text, onOpen }: ResultProps) {
  const result = useQuery(api.messaging.adminChat.listSessions, { searchQuery: text, status: "all", adminStatus: "all", paginationOpts: { numItems: SHOWN, cursor: null } });
  if (result === undefined) return <SearchLoading label="chats" />;
  const chatRows = result.sessions.slice(0, SHOWN);
  return chatRows.length ? (
    <section aria-label="Chats" className="grid">
      <h3 className="px-2 text-xs font-medium text-sidebar-foreground/70">Chats</h3>
      {chatRows.map((chat) => (
        <Link key={chat._id} href={`/admin/chats?session=${encodeURIComponent(chat._id)}`} className={linkClass} onClick={onOpen}>
          <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{chat.visitorName || chat.visitorEmail || chat.visitorPhone || guestLabel(chat.channel)}</span>
        </Link>
      ))}
    </section>
  ) : null;
}

function AppointmentResults({ text, onOpen }: ResultProps) {
  const result = useQuery(api.services.admin.searchAppointments, { query: text });
  if (result === undefined) return <SearchLoading label="appointments" />;
  const spaRows = result.results.slice(0, SHOWN);
  return spaRows.length ? (
    <section aria-label="Appointments" className="grid">
      <h3 className="px-2 text-xs font-medium text-sidebar-foreground/70">Appointments</h3>
      {spaRows.map((appointment) => (
        <Link key={appointment._id} href={staffCalendarHref({ date: resortIsoDate(appointment.start), appointmentId: appointment._id })} className={linkClass} onClick={onOpen}>
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{appointment.guestName || `Ref ${appointment.confirmationCode.slice(-6)}`}</span>
          <span className="shrink-0 text-xs text-sidebar-foreground/70">{staffDate(appointment.start)} · {staffTime(appointment.start)}</span>
        </Link>
      ))}
    </section>
  ) : null;
}
