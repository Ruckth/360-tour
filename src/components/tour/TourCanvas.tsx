"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { SRGBColorSpace, TextureLoader, type Texture } from "three";
import { Hotspot } from "@/components/tour/Hotspot";
import { RoomSphere } from "@/components/tour/RoomSphere";
import type { Room } from "@/lib/data/rooms";
import { useEffect, useMemo, useState } from "react";

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
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    onLoaded();
  }, [onLoaded, textureMap]);

  useEffect(() => {
    setProgress(transitioning ? 0 : 1);
  }, [transitioning, currentRoomId]);

  useFrame((_, delta) => {
    if (!transitioning) return;
    setProgress((value) => {
      const next = Math.min(1, value + delta / 0.4);
      if (next >= 1) onTransitionComplete();
      return next;
    });
  });

  const currentRoom = rooms.find((room) => room.id === currentRoomId) ?? rooms[0];
  const previousTexture = previousRoomId ? textureMap[previousRoomId] : undefined;
  const currentTexture = textureMap[currentRoomId];

  return (
    <>
      <PerspectiveCamera makeDefault fov={75} near={0.1} far={1100} position={[0, 0, 0.1]} />
      <OrbitControls enableZoom={false} enablePan={false} enableDamping dampingFactor={0.12} rotateSpeed={-0.45} />
      {previousTexture && transitioning ? (
        <RoomSphere texture={previousTexture} opacity={1 - progress} />
      ) : null}
      {currentTexture ? (
        <RoomSphere texture={currentTexture} opacity={transitioning ? progress : 1} />
      ) : null}
      {!transitioning
        ? currentRoom.hotspots.map((hotspot) => (
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
    <Canvas gl={{ antialias: true }}>
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
