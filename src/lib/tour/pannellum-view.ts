// Pure geometry and error rules for the Pannellum guest renderer. Hotspot positions are stored in the
// three.js world of `RoomSphere` (see tour-geometry); Pannellum addresses the same image point by yaw/pitch.

import { SPHERE_ROTATION_Y } from "@/lib/tour-geometry";

const DEG = 180 / Math.PI;

/** Wraps an angle in degrees to (-180, 180]. */
function wrapDegrees(value: number) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * The yaw/pitch at which Pannellum draws the equirectangular image point that the three.js sphere
 * draws in this world-space direction. The sphere maps image column u to azimuth φ = 2πu
 * (x = -cos φ, z = sin φ) and is then turned by `SPHERE_ROTATION_Y`.
 */
export function pannellumView([x, y, z]: readonly number[]) {
  const length = Math.hypot(x, y, z);
  if (!length) return { yaw: 0, pitch: 0 };
  const cos = Math.cos(-SPHERE_ROTATION_Y);
  const sin = Math.sin(-SPHERE_ROTATION_Y);
  // Undo the sphere's turn, then read the azimuth of the unrotated geometry.
  const localX = x * cos + z * sin;
  const localZ = -x * sin + z * cos;
  const phi = Math.atan2(localZ, -localX);
  const yaw = wrapDegrees(phi * DEG - 180);
  const pitch = Math.asin(Math.max(-1, Math.min(1, y / length))) * DEG;
  return { yaw: Math.round(yaw * 100) / 100 || 0, pitch: Math.round(pitch * 100) / 100 || 0 };
}

/** The existing renderer opens looking down -Z; start Pannellum on the same image point. */
export const INITIAL_VIEW = pannellumView([0, 0, -1]);

/** Vertical field of view of the existing tour camera, in degrees. */
const TOUR_VERTICAL_FOV = 75;

/** Pannellum takes a horizontal field of view; keep the existing renderer's vertical one. */
export function tourHfov(width: number, height: number) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const hfov = 2 * Math.atan(Math.tan(TOUR_VERTICAL_FOV / 2 / DEG) * aspect) * DEG;
  return Math.min(120, Math.max(30, Math.round(hfov * 10) / 10));
}

/**
 * Pannellum reports every failure as display text. These tokens replace its strings so a
 * missing or unreadable image (retryable) is told apart from an unusable renderer (fallback).
 */
const FILE_ERROR = "tour-file-error";
export const PANNELLUM_STRINGS = {
  fileAccessError: `${FILE_ERROR}:%s`,
  malformedURLError: FILE_ERROR,
  noPanoramaError: "tour-renderer-error",
  genericWebGLError: "tour-renderer-error",
  noWebGLError: "tour-renderer-error",
  textureSizeError: "tour-renderer-error:%s:%s",
  iOS8WebGLError: "tour-renderer-error",
  unknownError: "tour-renderer-error",
} as const;

export function pannellumErrorKind(message: unknown): "file" | "renderer" {
  return typeof message === "string" && message.startsWith(FILE_ERROR) ? "file" : "renderer";
}
