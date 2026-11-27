import { expect, it } from "vitest";
import { INITIAL_VIEW, PANNELLUM_STRINGS, pannellumErrorKind, pannellumView, tourHfov } from "@/lib/tour/pannellum-view";
import { SPHERE_ROTATION_Y } from "@/lib/tour-geometry";

/** World direction at which three's SphereGeometry (turned like RoomSphere) draws image point (u, v). */
function threeDirection(u: number, v: number) {
  const phi = u * 2 * Math.PI;
  const theta = v * Math.PI;
  const x = -Math.cos(phi) * Math.sin(theta);
  const y = Math.cos(theta);
  const z = Math.sin(phi) * Math.sin(theta);
  const c = Math.cos(SPHERE_ROTATION_Y);
  const s = Math.sin(SPHERE_ROTATION_Y);
  return [x * c + z * s, y, -x * s + z * c];
}

it("places a hotspot on the same image point the existing sphere draws it on", () => {
  for (const [u, v] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.4], [0.1, 0.7], [0.9, 0.2]]) {
    const { yaw, pitch } = pannellumView(threeDirection(u, v).map((value) => value * 360));
    // Pannellum: yaw 0 is the image centre, positive to the right; pitch 90 is the top edge.
    expect(yaw).toBeCloseTo(u * 360 - 180, 1);
    expect(pitch).toBeCloseTo(90 - v * 180, 1);
  }
  expect(pannellumView([0, 0, 0])).toEqual({ yaw: 0, pitch: 0 });
});

it("opens on the image point the existing camera faces", () => {
  expect(INITIAL_VIEW).toEqual({ yaw: -90, pitch: 0 });
});

it("keeps the existing 75° vertical field of view as Pannellum's horizontal one", () => {
  expect(tourHfov(1000, 1000)).toBeCloseTo(75, 0);
  expect(tourHfov(390, 844)).toBeCloseTo(39, 0);
  expect(tourHfov(3000, 500)).toBe(120);
  expect(tourHfov(0, 0)).toBeCloseTo(75, 0);
});

it("tells file failures (retryable) from renderer failures (fallback)", () => {
  expect(pannellumErrorKind(PANNELLUM_STRINGS.fileAccessError.replace("%s", "<a>x</a>"))).toBe("file");
  expect(pannellumErrorKind(PANNELLUM_STRINGS.malformedURLError)).toBe("file");
  expect(pannellumErrorKind(PANNELLUM_STRINGS.genericWebGLError)).toBe("renderer");
  expect(pannellumErrorKind(PANNELLUM_STRINGS.textureSizeError)).toBe("renderer");
  expect(pannellumErrorKind(undefined)).toBe("renderer");
});
