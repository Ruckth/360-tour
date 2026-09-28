import type { ThreeEvent } from "@react-three/fiber";
import type { Ref } from "react";
import { BackSide, type Mesh, type MeshBasicMaterial, type Texture } from "three";
import { SPHERE_RADIUS, SPHERE_ROTATION_Y, SPHERE_SEGMENTS } from "@/lib/tour-geometry";

export function RoomSphere({
  texture,
  opacity = 1,
  materialRef,
  meshRef,
  onClick,
}: {
  texture: Texture;
  opacity?: number;
  materialRef?: Ref<MeshBasicMaterial>;
  meshRef?: Ref<Mesh>;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <mesh ref={meshRef} onClick={onClick} rotation={[0, SPHERE_ROTATION_Y, 0]}>
      <sphereGeometry args={[SPHERE_RADIUS, ...SPHERE_SEGMENTS]} />
      <meshBasicMaterial
        ref={materialRef}
        map={texture}
        side={BackSide}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}
