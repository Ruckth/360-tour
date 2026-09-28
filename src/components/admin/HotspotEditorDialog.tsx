"use client";

import { Html } from "@react-three/drei";
import { Canvas, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { Eye, Loader2, Trash2 } from "lucide-react";
import { Suspense, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Raycaster, SRGBColorSpace, TextureLoader, Vector2, type Mesh } from "three";
import { Hotspot } from "@/components/tour/Hotspot";
import { RoomSphere } from "@/components/tour/RoomSphere";
import { TourCamera } from "@/components/tour/TourCanvas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toHotspotPosition, type HotspotPosition } from "@/lib/tour-geometry";
import { useConfirm } from "./ConfirmDialog";
import { NATIVE_SELECT, SaveStatus, useSaver } from "./property-form";

type Room = Doc<"rooms">;
type Draft = { key: number; id?: string; label: string; targetRoomSlug: string; position: HotspotPosition };
type Marker = { key: number; label: string; targetRoomSlug: string; position: HotspotPosition };

/** Pointer travel (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 4;
/** drei Html stacks by distance within [16777271, 0] by default; the hotspot form goes above every marker. */
const ABOVE_MARKERS: [number, number] = [16777272, 16777272];

const asPosition = (position: number[]): HotspotPosition => [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0];
const isEmpty = (draft: Draft) => !draft.id && !draft.label.trim() && !draft.targetRoomSlug;

/**
 * Visual hotspot editor: the room's panorama as guests see it. Click to add a hotspot,
 * drag one to move it, click it to edit or delete; Preview walks between rooms like the tour.
 * Mount it only while open so each opening starts from the saved hotspots.
 */
export function HotspotEditorDialog({ room, rooms, onClose }: { room: Room; rooms: Room[]; onClose: () => void }) {
  const setHotspots = useMutation(api.adminProperties.setHotspots);
  const confirm = useConfirm();
  const save = useSaver();
  const targets = rooms.filter((other) => other._id !== room._id);
  const [initial] = useState<Draft[]>(() =>
    room.hotspots.map(({ id, label, targetRoomSlug, position }, key) => ({
      key,
      id,
      label,
      targetRoomSlug,
      position: asPosition(position),
    })),
  );
  const [drafts, setDrafts] = useState(initial);
  const [nextKey, setNextKey] = useState(initial.length);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [viewSlug, setViewSlug] = useState(room.slug);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const selected = drafts.find((draft) => draft.key === selectedKey);
  const viewRoom = (preview && rooms.find((other) => other.slug === viewSlug)) || room;

  const change = (key: number, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  /** Selects a hotspot (or none), dropping a just-added one that was left blank. */
  function select(key: number | null) {
    setDrafts((current) => current.filter((draft) => draft.key === key || !isEmpty(draft)));
    setSelectedKey(key);
  }

  function add(position: HotspotPosition) {
    const targetRoomSlug = targets.length === 1 ? targets[0].slug : "";
    const label = targets.length === 1 ? targets[0].name : "";
    setDrafts((current) => [...current.filter((draft) => !isEmpty(draft)), { key: nextKey, label, targetRoomSlug, position }]);
    setSelectedKey(nextKey);
    setNextKey(nextKey + 1);
  }

  function remove(key: number) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setSelectedKey(null);
  }

  function togglePreview() {
    select(null);
    setViewSlug(room.slug);
    setPreview(!preview);
  }

  async function requestClose() {
    if (save.saving) return;
    if (dirty) {
      const discard = await confirm({
        title: "Discard hotspot changes?",
        description: "Your changes to this room's hotspots haven't been saved.",
        confirmLabel: "Discard",
        destructive: true,
      });
      if (!discard) return;
    }
    onClose();
  }

  async function submit() {
    const invalid = drafts.find((draft) => !draft.label.trim() || !draft.targetRoomSlug);
    if (invalid) {
      setPreview(false);
      setSelectedKey(invalid.key);
      setError("Every hotspot needs a label and a room it leads to.");
      return;
    }
    setError("");
    const saved = await save.run(() =>
      setHotspots({
        roomId: room._id,
        hotspots: drafts.map(({ id, label, targetRoomSlug, position }) => ({ id, label, targetRoomSlug, position })),
      }),
    );
    if (saved) onClose();
  }

  // In preview, other rooms show their saved hotspots; this room shows the unsaved drafts.
  const markers: Marker[] = viewRoom._id === room._id ? drafts : viewRoom.hotspots.map((hotspot, key) => ({ ...hotspot, key, position: asPosition(hotspot.position) }));
  const hint = preview
    ? `Preview${viewRoom._id === room._id ? "" : ` · ${viewRoom.name}`}: click a hotspot to walk to its room, like guests do.`
    : "Drag to look around. Click the panorama to add a hotspot; drag a hotspot to move it, click it to edit.";

  return (
    <Dialog open onOpenChange={(open) => !open && void requestClose()}>
      <DialogContent
        className="flex h-[90vh] max-w-6xl flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (selectedKey === null) return;
          event.preventDefault(); // Escape closes the hotspot form first
          select(null);
        }}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-border py-3 pl-4 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold">Hotspots · {room.name}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{hint}</DialogDescription>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <SaveStatus save={save} />}
          <Button size="sm" variant={preview ? "secondary" : "outline"} onClick={togglePreview} aria-pressed={preview}>
            <Eye aria-hidden className="size-4" />
            Preview
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void requestClose()} disabled={save.saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={save.saving || !dirty}>
            {save.saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save hotspots
          </Button>
        </div>
        <div className="relative min-h-0 flex-1 touch-none select-none bg-black">
          <Canvas resize={{ offsetSize: true }} dpr={[1, 1.5]} gl={{ antialias: false }} style={{ position: "absolute", inset: 0 }}>
            <TourCamera />
            <Suspense fallback={null}>
              <PanoramaScene
                key={viewRoom._id}
                imagePath={viewRoom.imagePath}
                markers={preview ? markers.filter((marker) => rooms.some((other) => other.slug === marker.targetRoomSlug)) : markers}
                preview={preview}
                selectedKey={selectedKey}
                onAdd={add}
                onMove={(key, position) => change(key, { position })}
                onSelect={select}
                onNavigate={setViewSlug}
              >
                {selected && !preview ? (
                  <Html position={selected.position} zIndexRange={ABOVE_MARKERS}>
                    <HotspotForm
                      draft={selected}
                      targets={targets}
                      onChange={(patch) => change(selected.key, patch)}
                      onDone={() => select(null)}
                      onDelete={() => remove(selected.key)}
                    />
                  </Html>
                ) : null}
              </PanoramaScene>
            </Suspense>
          </Canvas>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PanoramaScene({
  imagePath,
  markers,
  preview,
  selectedKey,
  onAdd,
  onMove,
  onSelect,
  onNavigate,
  children,
}: {
  imagePath: string;
  markers: Marker[];
  preview: boolean;
  selectedKey: number | null;
  onAdd: (position: HotspotPosition) => void;
  onMove: (key: number, position: HotspotPosition) => void;
  onSelect: (key: number | null) => void;
  onNavigate: (roomSlug: string) => void;
  children?: ReactNode;
}) {
  const loaded = useLoader(TextureLoader, imagePath);
  const texture = useMemo(() => {
    loaded.colorSpace = SRGBColorSpace;
    return loaded;
  }, [loaded]);
  const { camera, gl } = useThree();
  const sphere = useRef<Mesh>(null);
  const raycaster = useMemo(() => new Raycaster(), []);

  // Clicks on hotspots and the form bubble here too; only bare-panorama clicks (not drags) count.
  function clickPanorama(event: ThreeEvent<MouseEvent>) {
    if (preview || event.delta > CLICK_SLOP || event.nativeEvent.target !== gl.domElement) return;
    if (selectedKey !== null) onSelect(null);
    else onAdd(toHotspotPosition(event.point.toArray()));
  }

  /** Press on a hotspot: drag moves it along the sphere, a click selects it. */
  function pressMarker(key: number, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation(); // keep the view from turning
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const move = (moveEvent: PointerEvent) => {
      dragging ||= Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > CLICK_SLOP;
      if (!dragging || !sphere.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const pointer = new Vector2(((moveEvent.clientX - rect.left) / rect.width) * 2 - 1, -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(sphere.current)[0];
      if (hit) onMove(key, toHotspotPosition(hit.point.toArray()));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) onSelect(key);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <>
      <RoomSphere texture={texture} meshRef={sphere} onClick={clickPanorama} />
      {markers.map((marker) => (
        <Hotspot
          key={marker.key}
          position={marker.position}
          label={marker.label || "New hotspot"}
          selected={!preview && marker.key === selectedKey}
          onClick={preview ? () => onNavigate(marker.targetRoomSlug) : undefined}
          onPointerDown={preview ? undefined : (event) => pressMarker(marker.key, event)}
        />
      ))}
      {children}
    </>
  );
}

/** The small form next to the selected hotspot. It lives in its own React root (drei Html), so no context. */
function HotspotForm({
  draft,
  targets,
  onChange,
  onDone,
  onDelete,
}: {
  draft: Draft;
  targets: Room[];
  onChange: (patch: Partial<Draft>) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      onPointerDown={(event) => event.stopPropagation()} // don't turn the view

      className="mt-6 grid w-64 -translate-x-1/2 gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-xl"
    >
      <Input
        aria-label="Hotspot label"
        placeholder="Label, e.g. Pool"
        value={draft.label}
        onChange={(event) => onChange({ label: event.target.value })}
        autoFocus
      />
      <select
        aria-label="Leads to room"
        className={NATIVE_SELECT}
        value={draft.targetRoomSlug}
        onChange={(event) => {
          const target = targets.find((room) => room.slug === event.target.value);
          onChange({ targetRoomSlug: event.target.value, ...(!draft.label.trim() && target ? { label: target.name } : {}) });
        }}
      >
        <option value="" disabled>
          Leads to…
        </option>
        {targets.map((target) => (
          <option key={target._id} value={target.slug}>
            {target.name}
          </option>
        ))}
      </select>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
          <Trash2 aria-hidden className="size-4" />
          Delete
        </Button>
        <Button type="submit" size="sm">
          Done
        </Button>
      </div>
    </form>
  );
}
