import { useConvex } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffDate, staffTime } from "@/lib/staff-time";

export type SearchResult = FunctionReturnType<typeof api.services.admin.searchAppointments>["results"][number];

/** D14: a bounded, authorized lookup beyond the loaded dates; choosing a result opens it on its date. */
type LookupProps = {
  query: string;
  staffById: ReadonlyMap<string, Doc<"staff">>;
  serviceById: ReadonlyMap<string, Doc<"services">>;
  onOpen: (result: SearchResult) => void;
  onClose: () => void;
};

export function AllDatesResults(props: LookupProps) {
  return <LookupResults key={props.query} {...props} />;
}

function LookupResults({ query, staffById, serviceById, onOpen, onClose }: LookupProps) {
  const convex = useConvex();
  const [found, setFound] = useState<FunctionReturnType<typeof api.services.admin.searchAppointments>>();
  const [request, setRequest] = useState<{ cursor: string | null } | null>({ cursor: null });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!request) return;
    let active = true;
    void convex.query(api.services.admin.searchAppointments, { query, cursor: request.cursor }).then((page) => {
      if (!active) return;
      setFound((previous) => {
        const results = new Map(previous?.results.map((row) => [row._id, row]));
        for (const row of page.results) results.set(row._id, row);
        return { ...page, results: [...results.values()] };
      });
      setRequest(null);
    }, () => {
      if (!active) return;
      setFailed(true);
      setRequest(null);
    });
    return () => { active = false; };
  }, [convex, query, request]);
  return (
    <section aria-label="Appointments on all dates" className="border-b border-border px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {found === undefined ? (failed ? "Search unavailable" : "Searching all dates…") : `${found.results.length === 0 && !found.continueCursor ? "No" : found.results.length} ${found.results.length === 1 ? "match" : "matches"} for “${query}” within ${Math.round(found.windowDays / 30)} months of today${found.continueCursor ? " so far" : ""}`}
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {found?.results.length ? (
        <ul className="mt-1 grid gap-1">
          {found.results.map((result) => (
            <li key={result._id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(result)}>
                <span className="min-w-0">
                  <span className={cn("block truncate font-medium", result.status === "cancelled" && "line-through")}>{result.guestName || `Ref ${result.confirmationCode.slice(-6)}`}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {serviceById.get(result.serviceId)?.name ?? "Service"} · {staffById.get(result.staffId)?.name ?? "Staff"}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums">{staffDate(result.start, { weekday: true })} · {staffTime(result.start)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? <p role="alert">Couldn’t search appointments. Try again.</p> : null}
      {failed || found?.continueCursor ? (
        <Button size="sm" variant="outline" disabled={Boolean(request)} onClick={() => {
          setFailed(false);
          setRequest({ cursor: found?.continueCursor ?? null });
        }}>{request ? "Searching…" : failed ? "Retry search" : "Search more matches"}</Button>
      ) : null}
    </section>
  );
}

type NextFilters = Omit<FunctionArgs<typeof api.services.admin.nextAppointment>, "from" | "requestedAt" | "verify">;
type JumpProps = { from: number; filters: NextFilters; filtered: boolean; onOpen: (start: number) => void };

export function NextAppointmentJump(props: JumpProps) {
  return <JumpControl key={JSON.stringify([props.from, props.filters])} {...props} />;
}

function JumpControl({ from, filters, filtered, onOpen }: JumpProps) {
  const [rangeFilters] = useState(filters);
  const convex = useConvex();
  const [next, setNext] = useState<FunctionReturnType<typeof api.services.admin.nextAppointment>>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    let current = true;
    void convex.query(api.services.admin.nextAppointment, { from, ...rangeFilters, requestedAt: Date.now() }).then((result) => {
      if (current) setNext(result);
    }, () => {
      if (current) setError("Couldn’t look for the next appointment.");
    });
    return () => {
      current = false;
      active.current = false;
    };
  }, [convex, attempt, from, rangeFilters]);

  const appointment = next?.appointment;
  async function verify() {
    if (!appointment || checking) return;
    setChecking(true);
    setError("");
    try {
      const result = await convex.query(api.services.admin.nextAppointment, {
        from, ...rangeFilters, requestedAt: Date.now(), verify: { appointmentId: appointment._id, start: appointment.start },
      });
      if (!active.current) return;
      if (result.appointment) onOpen(result.appointment.start);
      else {
        setNext(undefined);
        setError("That appointment moved, disappeared, or no longer matches your calendar. Check again for the next appointment.");
      }
    } catch {
      if (active.current) setError("Couldn’t verify that appointment. Try again.");
    } finally {
      if (active.current) setChecking(false);
    }
  }

  return <>
    {appointment ? <Button variant="outline" disabled={checking} onClick={() => void verify()}>{checking ? "Checking appointment…" : `Next ${filtered ? "matching " : ""}appointment: ${staffDate(appointment.start, { weekday: true })} · ${staffTime(appointment.start)}`}</Button> : null}
    {next && !appointment ? <p className="text-xs text-muted-foreground">No {filtered ? "matching " : ""}appointments from {staffDate(from, { weekday: true })} to {staffDate(next.until - 1, { weekday: true })} either. Use the date controls to look further.</p> : null}
    {error ? <p role="alert" className="text-xs text-muted-foreground">{error}</p> : null}
    {error && !next ? <Button variant="outline" onClick={() => {
      setError("");
      setAttempt((previous) => previous + 1);
    }}>Check again</Button> : null}
  </>;
}
