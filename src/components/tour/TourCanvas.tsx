"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { SRGBColorSpace, TextureLoader, type MeshBasicMaterial, type Texture } from "three";
import { Hotspot } from "@/components/tour/Hotspot";
import { RoomSphere } from "@/components/tour/RoomSphere";
import type { Room } from "@/lib/data/rooms";
import { useEffect, useMemo, useRef } from "react";

/** The viewer at the sphere's center, looking around by dragging. */
export function TourCamera({ enabled = true }: { enabled?: boolean }) {
  return (
    <>
      <PerspectiveCamera makeDefault fov={75} near={0.1} far={1100} position={[0, 0, 0.1]} />
      <OrbitControls enabled={enabled} enableZoom={false} enablePan={false} enableDamping dampingFactor={0.12} rotateSpeed={-0.45} />
    </>
  );
}

function SphereScene({
  rooms,
  currentRoomId,
  previousRoomId,
  transitioning,
  onTransitionComplete,
  onLoaded,
  onNavigate,
}: {
  rooms: Room[];
  currentRoomId: string;
  previousRoomId: string | null;
  transitioning: boolean;
  onTransitionComplete: () => void;
  onLoaded: () => void;
  onNavigate: (roomId: string) => void;
}) {
  const paths = useMemo(() => rooms.map((room) => room.imagePath), [rooms]);
  const textures = useLoader(TextureLoader, paths) as Texture[];
  const textureMap = useMemo(() => {
    const map: Record<string, Texture> = {};
    rooms.forEach((room, index) => {
      const texture = textures[index];
      texture.colorSpace = SRGBColorSpace;
      map[room.id] = texture;
    });
    return map;
  }, [rooms, textures]);
  const progressRef = useRef(1);
  const completedRef = useRef(false);
  const previousMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const currentMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const activeRoomIds = useMemo(() => new Set(rooms.map((room) => room.id)), [rooms]);

  useEffect(() => {
    onLoaded();
  }, [onLoaded, textureMap]);

  useEffect(() => {
    progressRef.current = transitioning ? 0 : 1;
    completedRef.current = false;
    if (previousMaterialRef.current) previousMaterialRef.current.opacity = transitioning ? 1 : 0;
    if (currentMaterialRef.current) currentMaterialRef.current.opacity = transitioning ? 0 : 1;
  }, [transitioning, currentRoomId]);

  useFrame((state, delta) => {
    if (!transitioning) return;
    const next = Math.min(1, progressRef.current + delta / 0.4);
    progressRef.current = next;
    if (previousMaterialRef.current) previousMaterialRef.current.opacity = 1 - next;
    if (currentMaterialRef.current) currentMaterialRef.current.opacity = next;
    state.invalidate();
    if (next >= 1 && !completedRef.current) {
      completedRef.current = true;
      onTransitionComplete();
    }
  });

  const currentRoom = rooms.find((room) => room.id === currentRoomId) ?? rooms[0];
  const previousTexture = previousRoomId ? textureMap[previousRoomId] : undefined;
  const currentTexture = textureMap[currentRoomId];

  return (
    <>
      <TourCamera />
      {previousTexture && transitioning ? (
        <RoomSphere texture={previousTexture} opacity={1} materialRef={previousMaterialRef} />
      ) : null}
      {currentTexture ? (
        <RoomSphere texture={currentTexture} opacity={transitioning ? 0 : 1} materialRef={currentMaterialRef} />
      ) : null}
      {!transitioning
        ? currentRoom.hotspots.filter((hotspot) => activeRoomIds.has(hotspot.targetRoomId)).map((hotspot) => (
            <Hotspot
              key={hotspot.id}
              position={hotspot.position}
              label={hotspot.label}
              onClick={() => onNavigate(hotspot.targetRoomId)}
            />
          ))
        : null}
    </>
  );
}

export function TourCanvas({
  rooms,
  currentRoomId,
  previousRoomId,
  transitioning,
  onTransitionComplete,
  onLoaded,
  onNavigate,
}: {
  rooms: Room[];
  currentRoomId: string;
  previousRoomId: string | null;
  transitioning: boolean;
  onTransitionComplete: () => void;
  onLoaded: () => void;
  onNavigate: (roomId: string) => void;
}) {
  return (
    <Canvas dpr={[1, 1.5]} gl={{ antialias: false, powerPreference: "high-performance" }}>
      <SphereScene
        rooms={rooms}
        currentRoomId={currentRoomId}
        previousRoomId={previousRoomId}
        transitioning={transitioning}
        onTransitionComplete={onTransitionComplete}
        onLoaded={onLoaded}
        onNavigate={onNavigate}
      />
    </Canvas>
  );
}
