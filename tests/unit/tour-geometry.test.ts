import { Mesh, MeshBasicMaterial, BackSide, Raycaster, SphereGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { HOTSPOT_RADIUS, SPHERE_RADIUS, SPHERE_ROTATION_Y, SPHERE_SEGMENTS, toHotspotPosition } from "@/lib/tour-geometry";

/** The panorama sphere exactly as `RoomSphere` builds it. */
function roomSphere(rotationY = SPHERE_ROTATION_Y) {
  const mesh = new Mesh(new SphereGeometry(SPHERE_RADIUS, ...SPHERE_SEGMENTS), new MeshBasicMaterial({ side: BackSide }));
  mesh.rotation.y = rotationY;
  mesh.updateMatrixWorld();
  return mesh;
}

/** Where a click in the direction of `[x, y, z]` from the viewer hits the sphere. */
function hitToward(sphere: Mesh, [x, y, z]: number[]) {
  const hit = new Raycaster(new Vector3(0, 0, 0), new Vector3(x, y, z).normalize()).intersectObject(sphere)[0];
  if (!hit?.uv) throw new Error("missed the sphere");
  return hit;
}

const expectClose = (actual: number[], expected: number[], precision = 0.2) =>
  actual.forEach((value, axis) => expect(Math.abs(value - expected[axis])).toBeLessThanOrEqual(precision));

describe("toHotspotPosition", () => {
  it("keeps the direction and places the hotspot at HOTSPOT_RADIUS", () => {
    expect(toHotspotPosition([0, 0, -SPHERE_RADIUS])).toEqual([0, 0, -HOTSPOT_RADIUS]);
    const position = toHotspotPosition([300, -30, -200]);
    expect(Math.hypot(...position)).toBeCloseTo(HOTSPOT_RADIUS, 0);
    expectClose(position, [298.5, -29.9, -199]);
  });

  it("rounds to 0.1 and falls back to straight ahead for a zero vector", () => {
    for (const value of toHotspotPosition([123.456, 78.9, -321])) expect(Math.round(value * 10) / 10).toBe(value);
    expect(toHotspotPosition([0, 0, 0])).toEqual([0, 0, -HOTSPOT_RADIUS]);
  });
});

describe("hotspot positions on the panorama sphere", () => {
  const sphere = roomSphere();

  it("round-trips: stored position → click on the sphere → the same stored position", () => {
    const seeded = [[300, -30, -200], [-300, 0, 200], [250, -30, 300], [-250, 0, -300], [10, 340, 5], [20, -355, 5]];
    for (const stored of seeded.map(toHotspotPosition)) {
      const hit = hitToward(sphere, stored);
      expect(hit.point.length()).toBeLessThanOrEqual(SPHERE_RADIUS + 0.01);
      expect(hit.point.length()).toBeGreaterThan(SPHERE_RADIUS * 0.99);
      expectClose(toHotspotPosition(hit.point.toArray()), stored);
    }
  });

  it("accounts for the sphere's π turn: the panorama's middle column faces -x, its quarter column faces -z", () => {
    // Texture u runs 0→1 across the equirectangular image; v = 0.5 is the horizon.
    const middle = hitToward(sphere, [-HOTSPOT_RADIUS, 0, 0]).uv!;
    expect(middle.x).toBeCloseTo(0.5, 2);
    expect(middle.y).toBeCloseTo(0.5, 2);
    expect(hitToward(sphere, [0, 0, -HOTSPOT_RADIUS]).uv!.x).toBeCloseTo(0.25, 2);
    // Without the turn the same direction would show the image's seam instead.
    expect(hitToward(roomSphere(0), [-HOTSPOT_RADIUS, 0, 0]).uv!.x % 1).toBeCloseTo(0, 2);
  });
});
