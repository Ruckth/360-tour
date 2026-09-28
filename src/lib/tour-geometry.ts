// Shared geometry of the 360° tour, used by the public tour and the admin hotspot editor.

export type HotspotPosition = [number, number, number];

/** The panorama sphere (`RoomSphere`): radius, width/height segments, and its turn around Y. */
export const SPHERE_RADIUS = 500;
export const SPHERE_SEGMENTS = [60, 40] as const;
export const SPHERE_ROTATION_Y = Math.PI;

/** Distance from the viewer where new hotspots go: inside the sphere, like the seeded ones (~360). */
export const HOTSPOT_RADIUS = 360;

/**
 * A world-space point on (or towards) the panorama → the stored hotspot position:
 * same direction, at `HOTSPOT_RADIUS`, rounded to 0.1.
 * Raycast hits are world-space (three applies the sphere's π turn), and hotspots render
 * at world-space positions, so the turn needs no extra handling here.
 */
export function toHotspotPosition([x, y, z]: readonly number[]): HotspotPosition {
  const length = Math.hypot(x, y, z);
  if (!length) return [0, 0, -HOTSPOT_RADIUS];
  const scale = HOTSPOT_RADIUS / length;
  return [round(x * scale), round(y * scale), round(z * scale)];
}

const round = (value: number) => Math.round(value * 10) / 10 || 0;
