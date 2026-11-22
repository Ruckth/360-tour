import { LinearFilter, LinearMipmapLinearFilter, Vector3, type Camera, type PerspectiveCamera, type Texture } from "three";
import { isBundledMobileRendition } from "@/lib/tour/panoramas";

const direction = new Vector3();
const deferred = new WeakSet<Texture>();
const prepared = new WeakSet<Texture>();

/**
 * Can the entire camera view magnify the base level? A perspective pixel spans at most
 * 2 tan(fov/2) / bufferHeight radians. At latitude L a 2:1 panorama has at most
 * width / (2π cos L) texels per radian. Include the most distant corner, a sphere
 * segment and a margin for the mesh's interpolated UVs and slightly off-center camera.
 */
export function magnifiesPanorama(width: number, height: number, aspect: number, verticalFov: number, pitch: number) {
  if (!(width > 0 && height > 0 && aspect > 0 && verticalFov > 0 && verticalFov < Math.PI)) return false;
  const tangent = Math.tan(verticalFov / 2);
  const cornerAngle = Math.atan(tangent * Math.hypot(1, aspect));
  const maxLatitude = Math.abs(pitch) + cornerAngle + Math.PI / 30;
  if (maxLatitude >= Math.PI / 2) return false;
  return 1.25 * width * tangent < Math.PI * height * Math.cos(maxLatitude);
}

/** Keep trilinear sampling wherever a smaller mip level can contribute to the view. */
export function preparePanoramaFilter(texture: Texture, path: string, camera: Camera, bufferHeight: number) {
  if (prepared.has(texture)) return;
  const lens = camera as PerspectiveCamera;
  if (!lens.isPerspectiveCamera || !isBundledMobileRendition(path)) return;
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (image?.width !== 2048 || image.height !== 1024) return;
  const pitch = Math.asin(Math.max(-1, Math.min(1, lens.getWorldDirection(direction).y)));
  const magnified = magnifiesPanorama(2048, bufferHeight, lens.aspect, lens.getEffectiveFOV() * Math.PI / 180, pitch);
  if (magnified) {
    if (deferred.has(texture)) return;
    if (!texture.generateMipmaps || texture.minFilter !== LinearMipmapLinearFilter) return;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    deferred.add(texture);
  } else {
    prepared.add(texture);
    if (!deferred.has(texture)) return;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    deferred.delete(texture);
  }
}
