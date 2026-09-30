"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { adminStaffTabPath } from "@/components/admin/admin-routes";
import { Button, ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

type Staff = Doc<"staff">;
type Service = Doc<"services">;

const sameSet = (a: Set<string>, b: readonly string[]) => a.size === b.length && b.every((id) => a.has(id));

/** Services × active staff checkboxes, saved in one batch. Edits are kept as overrides until saved. */
export function ServiceStaffMatrix({
  services,
  staff,
  onDirtyChange,
}: {
  services: Service[];
  staff: Staff[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const save = useMutation(api.adminServices.setServiceStaffMatrix);
  const [edits, setEdits] = useState<Map<Id<"services">, Set<string>>>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeIds = new Set<string>(staff.map((s) => s._id));
  // Archived staff already left every service; ignore any stale ids.
  const current = (service: Service) => service.staffIds.filter((id) => activeIds.has(id));
  const assigned = (service: Service) => edits.get(service._id) ?? new Set<string>(current(service));
  const changed = services.filter((service) => edits.has(service._id) && !sameSet(edits.get(service._id)!, current(service)));
  const empty = services.filter((service) => assigned(service).size === 0);
  const dirty = changed.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  function setRow(service: Service, next: Set<string>) {
    setNotice("");
    setEdits((map) => new Map(map).set(service._id, next));
  }

  function toggleCell(service: Service, staffId: string) {
    const next = new Set(assigned(service));
    if (next.has(staffId)) next.delete(staffId);
    else next.add(staffId);
    setRow(service, next);
  }

  function toggleRow(service: Service) {
    setRow(service, assigned(service).size === staff.length ? new Set() : new Set(activeIds));
  }

  function toggleColumn(staffId: string) {
    const all = services.every((service) => assigned(service).has(staffId));
    setNotice("");
    setEdits((map) => {
      const next = new Map(map);
      for (const service of services) {
        const row = new Set(assigned(service));
        if (all) row.delete(staffId);
        else row.add(staffId);
        next.set(service._id, row);
      }
      return next;
    });
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const { updated } = await save({
        assignments: changed.map((service) => ({
          serviceId: service._id,
          staffIds: [...assigned(service)] as Id<"staff">[],
        })),
      });
      setEdits(new Map());
      setNotice(updated === 1 ? "Saved 1 service." : `Saved ${updated} services.`);
    } catch (err) {
      setError(errorText(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  if (!services.length || !staff.length) {
    return (
      <div className="grid justify-items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">{services.length ? "No active staff yet." : "No active services yet."}</p>
        {services.length ? (
          <ButtonLink href={adminStaffTabPath("staff")} size="sm">
            Add staff
          </ButtonLink>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="admin-eyebrow sticky start-0 z-10 bg-card px-4 py-2 text-start">
                Service
              </th>
              {staff.map((person) => (
                <th key={person._id} scope="col" className="px-1 py-2 font-normal">
                  <button
                    type="button"
                    onClick={() => toggleColumn(person._id)}
                    title={`Toggle ${person.name} for every service`}
                    className="mx-auto flex w-16 flex-col items-center gap-1 rounded-md px-1 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <StaffAvatar staff={person} className="size-7" />
                    <span className="w-full truncate text-xs">{person.name}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.map((service) => {
              const row = assigned(service);
              const isEmpty = row.size === 0;
              return (
                <tr key={service._id} className={cn(isEmpty && "bg-destructive/5")}>
                  <th scope="row" className="sticky start-0 z-10 bg-card px-4 py-1.5 text-start font-normal">
                    <button
                      type="button"
                      onClick={() => toggleRow(service)}
                      title={`Toggle everyone for ${service.name}`}
                      className="-mx-2 flex max-w-56 flex-col rounded-md px-2 py-1 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate font-medium">{service.name}</span>
                      <span className={cn("text-xs", isEmpty ? "text-destructive" : "text-muted-foreground")}>
                        {isEmpty ? "No one assigned" : `${row.size} of ${staff.length}`}
                      </span>
                    </button>
                  </th>
                  {staff.map((person) => (
                    <td key={person._id} className="px-1 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-foreground"
                        aria-label={`${person.name} performs ${service.name}`}
                        checked={row.has(person._id)}
                        onChange={() => toggleCell(service, person._id)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <p className="flex-1 text-xs text-muted-foreground" role="status">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : empty.length ? (
            <span className="text-destructive">
              {empty.map((s) => s.name).join(", ")} {empty.length === 1 ? "needs" : "need"} at least one person.
            </span>
          ) : dirty ? (
            `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}.`
          ) : (
            notice || "Click a name to toggle a whole row or column."
          )}
        </p>
        <Button size="sm" variant="outline" disabled={!edits.size || saving} onClick={() => setEdits(new Map())}>
          Reset
        </Button>
        <Button size="sm" disabled={!dirty || empty.length > 0 || saving} onClick={submit}>
          {saving ? <Spinner className="text-current" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
