"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HOTSPOT_RADIUS, SPHERE_RADIUS } from "@/lib/tour-geometry";
import { NATIVE_SELECT, SaveBar, useSaver } from "./property-form";

type Room = Doc<"rooms">;
type Draft = { id?: string; label: string; targetRoomSlug: string; position: [string, string, string] };

const AXES = ["x", "y", "z"] as const;

/** Hotspots as an editable list with exact positions; the visual editor is `HotspotEditorDialog`. */
export function RoomHotspotList({ room, rooms }: { room: Room; rooms: Room[] }) {
  const setHotspots = useMutation(api.adminProperties.setHotspots);
  const save = useSaver();
  const targets = rooms.filter((other) => other._id !== room._id);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    room.hotspots.map(({ id, label, targetRoomSlug, position }) => ({
      id,
      label,
      targetRoomSlug,
      position: [0, 1, 2].map((axis) => String(position[axis] ?? 0)) as Draft["position"],
    })),
  );

  const change = (index: number, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  function submit(event: FormEvent) {
    event.preventDefault();
    void save.run(() =>
      setHotspots({
        roomId: room._id,
        hotspots: drafts.map(({ id, label, targetRoomSlug, position }) => ({
          id,
          label,
          targetRoomSlug,
          position: position.map(Number),
        })),
      }),
    );
  }

  if (!targets.length) {
    return <p className="text-sm text-muted-foreground">Add another room first; hotspots move guests between rooms.</p>;
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        Position is x, y, z from the viewer, with y pointing up; hotspots placed visually sit {HOTSPOT_RADIUS} away, inside the
        panorama sphere (radius {SPHERE_RADIUS}).
      </p>
      {drafts.map((draft, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_repeat(3,5rem)_auto] sm:items-center">
          <Input aria-label="Hotspot label" placeholder="Label, e.g. Pool" value={draft.label} onChange={(event) => change(index, { label: event.target.value })} required />
          <select
            aria-label="Target room"
            className={NATIVE_SELECT}
            value={draft.targetRoomSlug}
            onChange={(event) => change(index, { targetRoomSlug: event.target.value })}
            required
          >
            <option value="" disabled>
              Goes to…
            </option>
            {targets.map((target) => (
              <option key={target._id} value={target.slug}>
                {target.name}
              </option>
            ))}
          </select>
          {AXES.map((axis, axisIndex) => (
            <Input
              key={axis}
              aria-label={`Position ${axis}`}
              placeholder={axis}
              type="number"
              step="any"
              min={-1000}
              max={1000}
              value={draft.position[axisIndex]}
              onChange={(event) => {
                const position = [...draft.position] as Draft["position"];
                position[axisIndex] = event.target.value;
                change(index, { position });
              }}
              required
            />
          ))}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
            aria-label={`Remove hotspot ${draft.label}`}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ))}
      <SaveBar save={save} compact label="Save hotspots">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mr-auto h-10"
          onClick={() => setDrafts((current) => [...current, { label: "", targetRoomSlug: "", position: ["0", "0", String(-HOTSPOT_RADIUS)] }])}
        >
          <Plus aria-hidden className="size-4" />
          Add hotspot
        </Button>
      </SaveBar>
    </form>
  );
}
