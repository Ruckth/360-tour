import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { rooms as staticRooms, type Hotspot, type Room } from "@/lib/data/rooms";
import { localizeRooms } from "@/lib/i18n/public-content";

/** `null`/`undefined`: Convex is unavailable or the villa is not active in the DB. */
export type DbTourRooms = FunctionReturnType<typeof api.properties.getTourRooms>;

/**
 * The rooms of a villa's public tour, first room first. Uses the admin-managed DB rooms
 * (already in tour order) when the villa has any, else the bundled rooms in `tourRoomIds`.
 * Hotspots pointing at rooms outside the tour are dropped.
 */
export function resolveTourRooms(
  tourRoomIds: string[],
  dbRooms: DbTourRooms | undefined,
  locale: string,
): Room[] {
  const rooms = dbRooms?.length
    ? dbRooms.map((room) => localizeUnedited(roomFromDb(room), locale))
    : localizeRooms(tourRoomIds.flatMap((id) => staticRooms.find((room) => room.id === id) ?? []), locale);
  const ids = new Set(rooms.map((room) => room.id));
  return rooms.map((room) => ({
    ...room,
    hotspots: room.hotspots.filter((hotspot) => ids.has(hotspot.targetRoomId)),
  }));
}

function roomFromDb(room: NonNullable<DbTourRooms>[number]): Room {
  return {
    id: room.slug,
    name: room.name,
    imagePath: room.imagePath,
    hotspots: room.hotspots.map(({ id, position, targetRoomSlug, label }) => ({
      id,
      position: position as Hotspot["position"],
      targetRoomId: targetRoomSlug,
      label,
    })),
  };
}

/** Bundled translations apply only to text the admin left as the bundled English. */
function localizeUnedited(room: Room, locale: string): Room {
  const [english] = localizeRooms([room], "en");
  const [translated] = localizeRooms([room], locale);
  return {
    ...room,
    name: room.name === english.name ? translated.name : room.name,
    hotspots: room.hotspots.map((hotspot, index) =>
      hotspot.label === english.hotspots[index].label ? translated.hotspots[index] : hotspot,
    ),
  };
}
