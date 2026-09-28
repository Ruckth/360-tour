"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { slugify } from "convex/lib/slug";
import { ArrowDown, ArrowUp, Loader2, MapPin, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/staff-bookings";
import { useConfirm } from "./ConfirmDialog";
import { RoomHotspotList } from "./RoomHotspotList";
import { Field, IMAGE_ACCEPT, panoramaWarning, SaveBar, SaveStatus, Section, Thumb, useImageUpload, useSaver } from "./property-form";

type Room = Doc<"rooms">;

/** 360° tour rooms in tour order: add, rename, replace panorama, reorder, delete, edit hotspots. */
export function PropertyRoomsEditor({ propertyId, rooms }: { propertyId: Id<"properties">; rooms: Room[] }) {
  const reorderRooms = useMutation(api.adminProperties.reorderRooms);
  const reorder = useSaver();

  function move(index: number, by: -1 | 1) {
    const slugs = rooms.map((room) => room.slug);
    [slugs[index], slugs[index + by]] = [slugs[index + by], slugs[index]];
    void reorder.run(() => reorderRooms({ propertyId, roomSlugs: slugs }));
  }

  return (
    <>
      <Section
        title="360° rooms"
        description="Rooms in tour order; the first is where the tour starts. Panoramas are 2:1 equirectangular JPEG, PNG or WebP up to 12 MB."
        actions={<SaveStatus save={reorder} />}
      >
        {rooms.length ? (
          <ol className="grid gap-3">
            {rooms.map((room, index) => (
              <RoomCard
                key={room._id}
                room={room}
                rooms={rooms}
                position={index + 1}
                onMoveUp={index > 0 ? () => move(index, -1) : undefined}
                onMoveDown={index < rooms.length - 1 ? () => move(index, 1) : undefined}
                reordering={reorder.saving}
              />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No rooms yet. Add the first panorama below.</p>
        )}
      </Section>
      <AddRoomForm propertyId={propertyId} />
    </>
  );
}

function RoomCard({
  room,
  rooms,
  position,
  onMoveUp,
  onMoveDown,
  reordering,
}: {
  room: Room;
  rooms: Room[];
  position: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  reordering: boolean;
}) {
  const updateRoom = useMutation(api.properties.updateRoom);
  const deleteRoom = useMutation(api.adminProperties.deleteRoom);
  const upload = useImageUpload();
  const confirm = useConfirm();
  const save = useSaver();
  const fileInput = useRef<HTMLInputElement>(null);
  const [imagePath, setImagePath] = useState(room.imagePath);
  const [warning, setWarning] = useState<string | null>(null);
  const [showHotspots, setShowHotspots] = useState(false);
  const linkedFrom = rooms.filter((other) => other.hotspots.some((hotspot) => hotspot.targetRoomSlug === room.slug));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    void save.run(() => updateRoom({ roomId: room._id, name, imagePath: imagePath.trim() }));
  }

  async function replacePanorama(file: File | undefined) {
    if (!file) return;
    setWarning(await panoramaWarning(file));
    await save.run(async () => {
      const url = await upload(file, "panorama");
      await updateRoom({ roomId: room._id, imagePath: url });
      setImagePath(url);
    });
  }

  async function remove() {
    const links = linkedFrom.length
      ? ` Hotspots in ${linkedFrom.map((other) => other.name).join(", ")} that lead here are removed too.`
      : "";
    const ok = await confirm({
      title: `Delete ${room.name}?`,
      description: `It's removed from the tour.${links}`,
      confirmLabel: "Delete room",
      destructive: true,
    });
    if (ok) await save.run(() => deleteRoom({ roomId: room._id }));
  }

  return (
    <li className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start gap-3">
        <Thumb src={room.imagePath} className="aspect-[2/1] w-40" />
        <form onSubmit={submit} className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
          <Field label={`${position}. Room name · ${room.slug}`} htmlFor={`room-${room._id}-name`}>
            <Input id={`room-${room._id}-name`} name="name" defaultValue={room.name} required />
          </Field>
          <Field label="Panorama image" htmlFor={`room-${room._id}-image`}>
            <Input id={`room-${room._id}-image`} value={imagePath} onChange={(event) => setImagePath(event.target.value)} required />
          </Field>
          <SaveBar save={save} compact />
        </form>
      </div>
      {warning ? <p className="text-xs text-amber-600">{warning}</p> : null}
      <div className="flex flex-wrap items-center gap-1">
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(event) => {
            void replacePanorama(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={save.saving} onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden className="size-4" />
          Replace panorama
        </Button>
        <Button size="sm" variant={showHotspots ? "secondary" : "outline"} onClick={() => setShowHotspots((open) => !open)} aria-expanded={showHotspots}>
          <MapPin aria-hidden className="size-4" />
          Hotspots ({room.hotspots.length})
        </Button>
        <span className="flex-1" />
        <Button size="icon" variant="ghost" className="size-8" disabled={!onMoveUp || reordering} onClick={onMoveUp} aria-label={`Move ${room.name} earlier in the tour`}>
          <ArrowUp aria-hidden className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" disabled={!onMoveDown || reordering} onClick={onMoveDown} aria-label={`Move ${room.name} later in the tour`}>
          <ArrowDown aria-hidden className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" disabled={save.saving} onClick={() => void remove()} aria-label={`Delete ${room.name}`}>
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </div>
      {showHotspots ? <RoomHotspotList key={JSON.stringify(room.hotspots)} room={room} rooms={rooms} /> : null}
    </li>
  );
}

function AddRoomForm({ propertyId }: { propertyId: Id<"properties"> }) {
  const createRoom = useMutation(api.adminProperties.createRoom);
  const upload = useImageUpload();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(next: File | undefined) {
    setFile(next ?? null);
    setWarning(next ? await panoramaWarning(next) : null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file && !url.trim()) {
      setError("Choose a panorama file or enter its URL.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const imagePath = file ? await upload(file, "panorama") : url.trim();
      await createRoom({ propertyId, name, slug: slug.trim() || undefined, imagePath });
      setName("");
      setSlug("");
      setUrl("");
      setFile(null);
      setWarning(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      setError(errorText(err, "Could not add the room."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Add a room" description="It's added at the end of the tour.">
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Room name" htmlFor="new-room-name">
            <Input id="new-room-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field label="Room slug (optional)" htmlFor="new-room-slug">
            <Input id="new-room-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={slugify(name) || "room"} />
          </Field>
          <Field label="Panorama file" htmlFor="new-room-file">
            <Input
              id="new-room-file"
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              onChange={(event) => void pick(event.target.files?.[0])}
              className="pt-2"
            />
          </Field>
          <Field label="…or panorama URL" htmlFor="new-room-url">
            <Input id="new-room-url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={Boolean(file)} placeholder="https://… or /public-path.webp" />
          </Field>
        </div>
        {warning ? <p className="text-xs text-amber-600">{warning}</p> : null}
        <div className="flex items-center justify-end gap-3">
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Add room
          </Button>
        </div>
      </form>
    </Section>
  );
}
