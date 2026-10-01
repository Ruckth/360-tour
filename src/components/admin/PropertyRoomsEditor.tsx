"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { slugify } from "convex/lib/slug";
import { ArrowDown, ArrowUp, MapPin, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { DisabledReason } from "./DisabledReason";
import { HotspotEditorDialog } from "./HotspotEditorDialog";
import { RoomHotspotList } from "./RoomHotspotList";
import { TONES } from "./status-tones";
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
          <p className="text-sm text-muted-foreground">No rooms yet. Add the first panorama under “Add a room” below.</p>
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
  const [editingHotspots, setEditingHotspots] = useState(false);
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
      // Put the upload in the field first: if saving the room fails, Save retries with it instead of re-uploading.
      setImagePath(url);
      await updateRoom({ roomId: room._id, imagePath: url });
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
      {warning ? <p className={cn("text-xs", TONES.warning.text)}>{warning}</p> : null}
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
        <DisabledReason reason={rooms.length < 2 && "Add another room first: hotspots move guests between rooms."}>
          <Button size="sm" variant="outline" disabled={rooms.length < 2} onClick={() => setEditingHotspots(true)}>
            <MapPin aria-hidden className="size-4" />
            Edit hotspots ({room.hotspots.length})
          </Button>
        </DisabledReason>
        <span className="flex-1" />
        <Button size="icon" variant="ghost" className="size-9" disabled={!onMoveUp || reordering} onClick={onMoveUp} aria-label={`Move ${room.name} earlier in the tour`}>
          <ArrowUp aria-hidden className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-9" disabled={!onMoveDown || reordering} onClick={onMoveDown} aria-label={`Move ${room.name} later in the tour`}>
          <ArrowDown aria-hidden className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-9" disabled={save.saving} onClick={() => void remove()} aria-label={`Delete ${room.name}`}>
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </div>
      {rooms.length > 1 ? (
        <details>
          <summary className="cursor-pointer rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Advanced: exact hotspot positions</summary>
          <div className="mt-2">
            <RoomHotspotList key={JSON.stringify(room.hotspots)} room={room} rooms={rooms} />
          </div>
        </details>
      ) : null}
      {editingHotspots ? <HotspotEditorDialog room={room} rooms={rooms} onClose={() => setEditingHotspots(false)} /> : null}
    </li>
  );
}

function AddRoomForm({ propertyId }: { propertyId: Id<"properties"> }) {
  const createRoom = useMutation(api.adminProperties.createRoom);
  const upload = useImageUpload();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // The picked file once uploaded, so retrying a failed createRoom doesn't upload (and orphan) it again.
  const [uploaded, setUploaded] = useState<{ file: File; url: string } | null>(null);
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
      let imagePath = url.trim();
      if (file) {
        imagePath = uploaded?.file === file ? uploaded.url : await upload(file, "panorama");
        setUploaded({ file, url: imagePath });
      }
      await createRoom({ propertyId, name, slug: slug.trim() || undefined, imagePath });
      setUploaded(null);
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
        {warning ? <p className={cn("text-xs", TONES.warning.text)}>{warning}</p> : null}
        <div className="flex items-center justify-end gap-3">
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner className="text-current" /> : null}
            Add room
          </Button>
        </div>
      </form>
    </Section>
  );
}
