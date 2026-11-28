// Shared geometry of the 360° tour, used by the public tour and the admin hotspot editor.

export type HotspotPosition = [number, number, number];

/** The panorama sphere (`RoomSphere`): radius, width/height segments, and its turn around Y. */
export const SPHERE_RADIUS = 500;
export const SPHERE_SEGMENTS = [60, 40] as const;
export const SPHERE_ROTATION_Y = Math.PI;

/** Distance from the viewer where new hotspots go: inside the sphere, like the seeded ones (~360). */
export const HOTSPOT_RADIUS = 360;

/** Elevation clamp (degrees) so keyboard positioning never reaches the degenerate ±90° poles. */
export const MAX_HOTSPOT_ELEVATION_DEG = 85;

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

/** Normalizes compass heading degrees into [0, 360). */
export function normalizeHeading(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((degrees % 360) + 360) % 360;
  const rounded = round(wrapped);
  return rounded >= 360 ? 0 : rounded;
}

/** Clamps elevation degrees into [-85, 85]. */
export function clampElevation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return round(Math.max(-MAX_HOTSPOT_ELEVATION_DEG, Math.min(MAX_HOTSPOT_ELEVATION_DEG, degrees)));
}

/** Converts a world-space hotspot position to compass heading [0, 360) and elevation [-85, 85] degrees. */
export function hotspotPositionToAngles([x, y, z]: readonly number[]): { heading: number; elevation: number } {
  const length = Math.hypot(x, y, z);
  if (!length) return { heading: 0, elevation: 0 };
  const elevationRad = Math.asin(Math.max(-1, Math.min(1, y / length)));
  const headingRad = Math.atan2(x, -z);
  return {
    heading: normalizeHeading((headingRad * 180) / Math.PI),
    elevation: clampElevation((elevationRad * 180) / Math.PI),
  };
}

/** Converts compass heading and elevation degrees to a world-space hotspot position at `HOTSPOT_RADIUS`. */
export function anglesToHotspotPosition(headingDeg: number, elevationDeg: number): HotspotPosition {
  const heading = (normalizeHeading(headingDeg) * Math.PI) / 180;
  const elevation = (clampElevation(elevationDeg) * Math.PI) / 180;
  const cosEl = Math.cos(elevation);
  return toHotspotPosition([
    cosEl * Math.sin(heading),
    Math.sin(elevation),
    -cosEl * Math.cos(heading),
  ]);
}

/** Nudges an existing hotspot position by heading and elevation degree deltas, preserving radius and bounds. */
export function nudgeHotspotPosition(
  position: readonly number[],
  deltaHeadingDeg: number,
  deltaElevationDeg: number,
): HotspotPosition {
  const { heading, elevation } = hotspotPositionToAngles(position);
  return anglesToHotspotPosition(heading + deltaHeadingDeg, elevation + deltaElevationDeg);
}

const round = (value: number) => Math.round(value * 10) / 10 || 0;
