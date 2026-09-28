import { describe, expect, it } from "vitest";
import { resolveTourRooms, type DbTourRooms } from "@/lib/tour/rooms";

const dbRooms: NonNullable<DbTourRooms> = [
  {
    slug: "terrace",
    name: "Terrace",
    imagePath: "/terrace.webp",
    hotspots: [
      { id: "terrace-to-pv-living", position: [1, 2, 3], targetRoomSlug: "pv-living", label: "Inside" },
      { id: "terrace-to-gone", position: [4, 5, 6], targetRoomSlug: "gone", label: "Gone" },
    ],
  },
  {
    slug: "pv-living",
    name: "Living Area",
    imagePath: "/new-living.webp",
    hotspots: [{ id: "pv-living-to-pool", position: [7, 8, 9], targetRoomSlug: "terrace", label: "Pool Area" }],
  },
];

describe("resolveTourRooms", () => {
  it("uses DB rooms in their tour order with DB hotspots", () => {
    const rooms = resolveTourRooms(["pv-living", "pv-pool"], dbRooms, "en");
    expect(rooms.map((room) => room.id)).toEqual(["terrace", "pv-living"]);
    expect(rooms[0]).toMatchObject({ name: "Terrace", imagePath: "/terrace.webp" });
    expect(rooms[0].hotspots).toEqual([
      { id: "terrace-to-pv-living", position: [1, 2, 3], targetRoomId: "pv-living", label: "Inside" },
    ]);
    expect(rooms[1].hotspots).toEqual([
      { id: "pv-living-to-pool", position: [7, 8, 9], targetRoomId: "terrace", label: "Pool Area" },
    ]);
  });

  it("translates only DB text the admin left as the bundled English", () => {
    const edited = [{ ...dbRooms[1], name: "Great Room" }, dbRooms[0]];
    const [living, terrace] = resolveTourRooms([], edited, "th");
    expect(living.name).toBe("Great Room");
    expect(living.hotspots[0].label).not.toBe("Pool Area");
    expect(terrace.name).toBe("Terrace");
    expect(resolveTourRooms([], [dbRooms[1]], "th")[0].name).not.toBe("Living Area");
  });

  it("falls back to the bundled rooms when the villa has no DB rooms or Convex is unavailable", () => {
    for (const db of [[], null, undefined]) {
      const rooms = resolveTourRooms(["pv-pool", "pv-living", "missing"], db, "en");
      expect(rooms.map((room) => room.id)).toEqual(["pv-pool", "pv-living"]);
      expect(rooms[0].hotspots.map((hotspot) => hotspot.targetRoomId)).toEqual(["pv-living"]);
    }
  });

  it("skips hotspots whose target is not in the tour", () => {
    const rooms = resolveTourRooms(["pv-living"], null, "en");
    expect(rooms).toHaveLength(1);
    expect(rooms[0].hotspots).toEqual([]);
  });
});
