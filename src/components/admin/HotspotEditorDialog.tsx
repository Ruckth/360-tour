"use client";

import { Html } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, Plus, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Raycaster, SRGBColorSpace, TextureLoader, Vector2, type Mesh, type Texture } from "three";
import { Hotspot } from "@/components/tour/Hotspot";
import { RoomSphere } from "@/components/tour/RoomSphere";
import { TourCamera } from "@/components/tour/TourCanvas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  anglesToHotspotPosition,
  HOTSPOT_RADIUS,
  hotspotPositionToAngles,
  MAX_HOTSPOT_ELEVATION_DEG,
  nudgeHotspotPosition,
  toHotspotPosition,
  type HotspotPosition,
} from "@/lib/tour-geometry";
import { useConfirm } from "./ConfirmDialog";
import { NATIVE_SELECT, SaveStatus, useSaver } from "./property-form";

type Room = Doc<"tourScenes">;
type Draft = { key: number; id?: string; label: string; targetRoomSlug: string; position: HotspotPosition };
type Marker = { key: number; label: string; targetRoomSlug: string; position: HotspotPosition };
type PanoramaLoadState = "loading" | "ready" | "error";

/** Pointer travel (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 4;
/** Keyboard nudge increment in degrees. */
const NUDGE_STEP_DEG = 5;
/** drei Html stacks by distance within [16777271, 0] by default; the hotspot form goes above every marker. */
const ABOVE_MARKERS: [number, number] = [16777272, 16777272];

const asPosition = (position: number[]): HotspotPosition => [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0];
const isEmpty = (draft: Draft) => !draft.id && !draft.label.trim() && !draft.targetRoomSlug;

/**
 * Visual hotspot editor: the room's panorama as guests see it. Click to add a hotspot,
 * drag one to move it, click it to edit or delete, or use the keyboard-accessible hotspot
 * list and heading/elevation controls; Preview walks between rooms like the tour.
 * Mount it only while open so each opening starts from the saved hotspots.
 */
export function HotspotEditorDialog({
  room,
  rooms,
  onClose,
  onCloseAutoFocus,
}: {
  room: Room;
  rooms: Room[];
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const setHotspots = useMutation(api.catalog.adminProperties.setHotspots);
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
  const [retryNonce, setRetryNonce] = useState(0);
  const [error, setError] = useState("");
  const listButtonRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const returnFocusKeyRef = useRef<number | null>(null);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const selected = drafts.find((draft) => draft.key === selectedKey);
  const viewRoom = (preview && rooms.find((other) => other.slug === viewSlug)) || room;
  const activeRequestKey = `${viewRoom._id}:${viewRoom.imagePath}:${retryNonce}`;
  const [textureStatus, setTextureStatus] = useState<{ requestKey: string; state: PanoramaLoadState }>({
    requestKey: activeRequestKey,
    state: "loading",
  });
  const panoramaState: PanoramaLoadState =
    textureStatus.requestKey === activeRequestKey ? textureStatus.state : "loading";

  const handleTextureStatus = useCallback((requestKey: string, state: PanoramaLoadState) => {
    setTextureStatus((current) =>
      current.requestKey === requestKey && current.state === state ? current : { requestKey, state },
    );
  }, []);

  const change = (key: number, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  /** Selects a hotspot (or none), dropping a just-added one that was left blank. */
  function select(key: number | null, options?: { restoreListFocus?: boolean }) {
    const previousKey = selectedKey;
    setDrafts((current) => current.filter((draft) => draft.key === key || !isEmpty(draft)));
    setSelectedKey(key);
    if (key !== null) {
      returnFocusKeyRef.current = key;
    } else if (options?.restoreListFocus && (returnFocusKeyRef.current !== null || previousKey !== null)) {
      const targetKey = returnFocusKeyRef.current ?? previousKey;
      returnFocusKeyRef.current = null;
      if (targetKey !== null) {
        queueMicrotask(() => listButtonRefs.current.get(targetKey)?.focus());
      }
    }
  }

  function add(position: HotspotPosition) {
    const targetRoomSlug = targets.length === 1 ? targets[0].slug : "";
    const label = targets.length === 1 ? targets[0].name : "";
    setDrafts((current) => [...current.filter((draft) => !isEmpty(draft)), { key: nextKey, label, targetRoomSlug, position }]);
    setSelectedKey(nextKey);
    returnFocusKeyRef.current = nextKey;
    setNextKey(nextKey + 1);
  }

  function remove(key: number) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setSelectedKey(null);
    returnFocusKeyRef.current = null;
  }

  function togglePreview() {
    select(null);
    setViewSlug(room.slug);
    setPreview(!preview);
  }

  function retryPanorama() {
    setRetryNonce((value) => value + 1);
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
  const hint =
    panoramaState === "loading"
      ? `Loading ${viewRoom.name} panorama…`
      : panoramaState === "error"
        ? `Could not load ${viewRoom.name} panorama. Your hotspot drafts are preserved.`
        : preview
          ? `Preview${viewRoom._id === room._id ? "" : ` · ${viewRoom.name}`}: click a hotspot to walk to its room, like guests do.`
          : "Drag to look around. Click the panorama to add a hotspot, drag or nudge it to move, or choose one from the hotspot list.";
  const selectedAngles = selected ? hotspotPositionToAngles(selected.position) : null;
  const targetNameFor = (slug: string) => targets.find((target) => target.slug === slug)?.name ?? "";

  return (
    <Dialog open onOpenChange={(open) => !open && void requestClose()}>
      <DialogContent
        className="flex h-[90dvh] max-w-6xl flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (selectedKey === null) return;
          event.preventDefault(); // Escape closes the hotspot form first
          select(null, { restoreListFocus: true });
        }}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-border py-3 pl-4 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Hotspots · {room.name}</DialogTitle>
            <DialogDescription className="text-xs">{hint}</DialogDescription>
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
            {save.saving ? <Spinner className="text-current" /> : null}
            Save hotspots
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative min-h-56 flex-1 touch-none select-none bg-black">
            <Canvas resize={{ offsetSize: true }} dpr={[1, 1.5]} gl={{ antialias: false }} style={{ position: "absolute", inset: 0 }}>
              <TourCamera />
              <PanoramaScene
                key={activeRequestKey}
                requestKey={activeRequestKey}
                imagePath={viewRoom.imagePath}
                markers={preview ? markers.filter((marker) => rooms.some((other) => other.slug === marker.targetRoomSlug)) : markers}
                preview={preview}
                selectedKey={selectedKey}
                onAdd={add}
                onMove={(key, position) => change(key, { position })}
                onSelect={(key) => select(key)}
                onNavigate={setViewSlug}
                onStatusChange={handleTextureStatus}
              >
                {selected && !preview && panoramaState === "ready" ? (
                  <Html position={selected.position} zIndexRange={ABOVE_MARKERS}>
                    <HotspotForm
                      draft={selected}
                      targets={targets}
                      onChange={(patch) => change(selected.key, patch)}
                      onDone={() => select(null, { restoreListFocus: true })}
                      onDelete={() => remove(selected.key)}
                    />
                  </Html>
                ) : null}
              </PanoramaScene>
            </Canvas>
            {panoramaState === "loading" ? (
              <div
                role="status"
                aria-live="polite"
                className="absolute inset-0 z-10 grid place-items-center bg-black/75 p-4 text-center text-sm text-white"
              >
                <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/80 px-4 py-3">
                  <Spinner className="text-white" />
                  <span>Loading {viewRoom.name} panorama…</span>
                </div>
              </div>
            ) : null}
            {panoramaState === "error" ? (
              <div
                role="alert"
                className="absolute inset-0 z-10 grid place-items-center bg-black/85 p-4 text-center text-sm text-white"
              >
                <div className="grid max-w-md justify-items-center gap-3 rounded-lg border border-white/15 bg-card p-5 text-card-foreground shadow-xl">
                  <p className="font-semibold">Could not load {viewRoom.name} panorama</p>
                  <p className="text-xs text-muted-foreground">
                    Your hotspot drafts are still here. Retry loading this panorama or return to review the room photo.
                  </p>
                  <p className="max-w-full break-all font-mono text-xs text-muted-foreground">{viewRoom.imagePath}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button type="button" size="sm" onClick={retryPanorama}>
                      <RotateCw aria-hidden className="size-4" />
                      Retry panorama
                    </Button>
                    {preview && viewRoom._id !== room._id ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => setViewSlug(room.slug)}>
                        Return to {room.name}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" onClick={() => void requestClose()}>
                        Review room photo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {!preview ? (
            <aside
              aria-label="Hotspot list"
              className="flex max-h-64 shrink-0 flex-col gap-3 overflow-y-auto border-t border-border bg-card p-3 md:max-h-none md:w-72 md:border-l md:border-t-0"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hotspots ({drafts.length})
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={() => add([0, 0, -HOTSPOT_RADIUS])}
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add hotspot
                </Button>
              </div>
              {drafts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No hotspots yet. Click the panorama or use Add hotspot to place one.
                </p>
              ) : (
                <ul className="grid gap-1.5">
                  {drafts.map((draft) => {
                    const angles = hotspotPositionToAngles(draft.position);
                    const isSelected = draft.key === selectedKey;
                    const displayLabel = draft.label.trim() || "New hotspot";
                    const targetLabel = targetNameFor(draft.targetRoomSlug);
                    return (
                      <li key={draft.key}>
                        <button
                          ref={(node) => {
                            if (node) listButtonRefs.current.set(draft.key, node);
                            else listButtonRefs.current.delete(draft.key);
                          }}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => select(isSelected ? null : draft.key)}
                          className={`grid w-full gap-0.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isSelected ? "border-foreground bg-muted text-foreground" : "border-border bg-background hover:bg-muted/60"
                          }`}
                        >
                          <span className="truncate font-medium text-foreground">Edit {displayLabel}</span>
                          <span className="truncate text-muted-foreground">
                            {targetLabel ? `→ ${targetLabel} · ` : ""}
                            {angles.heading}° · {angles.elevation}°
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {selected && selectedAngles ? (
                <div className="grid gap-2.5 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-foreground">
                      Position · {selected.label.trim() || "New hotspot"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => select(null, { restoreListFocus: true })}
                    >
                      Close
                    </Button>
                  </div>
                  {panoramaState !== "ready" ? (
                    <HotspotForm
                      draft={selected}
                      targets={targets}
                      onChange={(patch) => change(selected.key, patch)}
                      onDone={() => select(null, { restoreListFocus: true })}
                      onDelete={() => remove(selected.key)}
                      inline
                    />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Heading (°)</span>
                      <Input
                        aria-label="Heading"
                        type="number"
                        step={1}
                        value={selectedAngles.heading}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          if (!Number.isFinite(parsed)) return;
                          change(selected.key, {
                            position: anglesToHotspotPosition(parsed, selectedAngles.elevation),
                          });
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Elevation (°)</span>
                      <Input
                        aria-label="Elevation"
                        type="number"
                        step={1}
                        min={-MAX_HOTSPOT_ELEVATION_DEG}
                        max={MAX_HOTSPOT_ELEVATION_DEG}
                        value={selectedAngles.elevation}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          if (!Number.isFinite(parsed)) return;
                          change(selected.key, {
                            position: anglesToHotspotPosition(selectedAngles.heading, parsed),
                          });
                        }}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Nudge hotspot position">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() =>
                        change(selected.key, {
                          position: nudgeHotspotPosition(selected.position, -NUDGE_STEP_DEG, 0),
                        })
                      }
                    >
                      <ArrowLeft aria-hidden className="size-3.5" />
                      Left {NUDGE_STEP_DEG}°
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() =>
                        change(selected.key, {
                          position: nudgeHotspotPosition(selected.position, NUDGE_STEP_DEG, 0),
                        })
                      }
                    >
                      <ArrowRight aria-hidden className="size-3.5" />
                      Right {NUDGE_STEP_DEG}°
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() =>
                        change(selected.key, {
                          position: nudgeHotspotPosition(selected.position, 0, NUDGE_STEP_DEG),
                        })
                      }
                    >
                      <ArrowUp aria-hidden className="size-3.5" />
                      Up {NUDGE_STEP_DEG}°
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() =>
                        change(selected.key, {
                          position: nudgeHotspotPosition(selected.position, 0, -NUDGE_STEP_DEG),
                        })
                      }
                    >
                      <ArrowDown aria-hidden className="size-3.5" />
                      Down {NUDGE_STEP_DEG}°
                    </Button>
                  </div>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Panorama photos are sRGB: each texture is tagged as it loads, before anything draws it. */
class PanoramaTextureLoader extends TextureLoader {
  override load(...[url, onLoad, onProgress, onError]: Parameters<TextureLoader["load"]>) {
    return super.load(url, (texture) => {
      texture.colorSpace = SRGBColorSpace;
      onLoad?.(texture);
    }, onProgress, onError);
  }
}

function PanoramaScene({
  requestKey,
  imagePath,
  markers,
  preview,
  selectedKey,
  onAdd,
  onMove,
  onSelect,
  onNavigate,
  onStatusChange,
  children,
}: {
  requestKey: string;
  imagePath: string;
  markers: Marker[];
  preview: boolean;
  selectedKey: number | null;
  onAdd: (position: HotspotPosition) => void;
  onMove: (key: number, position: HotspotPosition) => void;
  onSelect: (key: number | null) => void;
  onNavigate: (roomSlug: string) => void;
  onStatusChange: (requestKey: string, state: PanoramaLoadState) => void;
  children?: ReactNode;
}) {
  const { camera, gl } = useThree();
  const sphere = useRef<Mesh>(null);
  const raycaster = useMemo(() => new Raycaster(), []);
  const [texture, setTexture] = useState<Texture | null>(null);
  // The marker drag in progress, so unmounting mid-drag removes its window listeners.
  const endDrag = useRef<(() => void) | null>(null);
  // Prevent pointerup + click from firing selection twice while allowing keyboard Enter/Space click.
  const suppressPointerClick = useRef(false);
  useEffect(() => () => endDrag.current?.(), []);

  useEffect(() => {
    let cancelled = false;
    let loadedTexture: Texture | null = null;
    onStatusChange(requestKey, "loading");
    const loader = new PanoramaTextureLoader();
    loader.load(
      imagePath,
      (nextTexture) => {
        if (cancelled) {
          nextTexture.dispose?.();
          return;
        }
        loadedTexture = nextTexture;
        setTexture(nextTexture);
        onStatusChange(requestKey, "ready");
      },
      undefined,
      () => {
        if (cancelled) return;
        onStatusChange(requestKey, "error");
      },
    );
    return () => {
      cancelled = true;
      loadedTexture?.dispose?.();
    };
  }, [imagePath, onStatusChange, requestKey]);

  // Clicks on hotspots and the form bubble here too; only bare-panorama clicks (not drags) count.
  function clickPanorama(event: ThreeEvent<MouseEvent>) {
    if (preview || event.delta > CLICK_SLOP || event.nativeEvent.target !== gl.domElement) return;
    if (selectedKey !== null) onSelect(null);
    else onAdd(toHotspotPosition(event.point.toArray()));
  }

  /** Press on a hotspot: drag moves it along the sphere, a click selects it. */
  function pressMarker(key: number, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation(); // keep the view from turning
    suppressPointerClick.current = true;
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
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      endDrag.current = null;
      queueMicrotask(() => {
        suppressPointerClick.current = false;
      });
    };
    const up = () => {
      stop();
      if (!dragging) onSelect(key);
    };
    endDrag.current?.();
    endDrag.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
  }

  if (!texture) return null;

  return (
    <>
      <RoomSphere texture={texture} meshRef={sphere} onClick={clickPanorama} />
      {markers.map((marker) => (
        <Hotspot
          key={marker.key}
          position={marker.position}
          label={marker.label || "New hotspot"}
          selected={!preview && marker.key === selectedKey}
          onClick={
            preview
              ? () => onNavigate(marker.targetRoomSlug)
              : () => {
                  if (suppressPointerClick.current) return;
                  onSelect(marker.key);
                }
          }
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
  inline = false,
}: {
  draft: Draft;
  targets: Room[];
  onChange: (patch: Partial<Draft>) => void;
  onDone: () => void;
  onDelete: () => void;
  inline?: boolean;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      onPointerDown={(event) => event.stopPropagation()} // don't turn the view
      className={
        inline
          ? "grid gap-2"
          : "mt-6 grid w-64 -translate-x-1/2 gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-xl"
      }
    >
      <Input
        aria-label="Hotspot label"
        placeholder="Label, e.g. Pool"
        value={draft.label}
        onChange={(event) => onChange({ label: event.target.value })}
        autoFocus={!inline}
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
