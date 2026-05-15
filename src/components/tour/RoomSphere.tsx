import { BackSide, type Texture } from "three";

export function RoomSphere({
  texture,
  opacity = 1,
}: {
  texture: Texture;
  opacity?: number;
}) {
  return (
    <mesh rotation={[0, Math.PI, 0]}>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial
        map={texture}
        side={BackSide}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}
