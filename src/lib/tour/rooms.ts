import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { rooms as staticRooms, type Hotspot, type Room } from "@/lib/data/rooms";
import { localizeRooms, type PublicMessages } from "@/lib/i18n/public-content";

/** `null`/`undefined`: Convex is unavailable or the villa is not active in the DB. */
export type DbTourRooms = FunctionReturnType<typeof api.properties.getTourRooms>;

/**
 * The rooms of a villa's public tour, first room first. Uses the admin-managed DB rooms
 * (already in tour order) when the villa has any, else the bundled rooms in `tourRoomIds`.
 * Hotspots pointing at rooms outside the tour are dropped.
 *
 * `messages` is the ACTIVE locale's dictionary (client: `useMessages()`); this module stays
 * free of all-locale JSON imports so it never bloats the tour client chunk.
 */
export function resolveTourRooms(
  tourRoomIds: string[],
  dbRooms: DbTourRooms | undefined,
  messages: PublicMessages,
): Room[] {
  const rooms = dbRooms?.length
    ? dbRooms.map((room) => localizeUnedited(roomFromDb(room), messages))
    : localizeRooms(tourRoomIds.flatMap((id) => staticRooms.find((room) => room.id === id) ?? []), messages);
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

/**
 * The English Rooms baseline, reconstructed from the bundled static rooms data instead of
 * importing `messages/en.json`. The static data IS the English source for the Rooms namespace
 * (verified identical to en.json), so this keeps the module free of locale dictionaries while
 * producing the same "unedited English?" comparison the previous `localizeRooms([room], "en")`
 * did — only room/hotspot text the admin left as the bundled English is translated.
 */
function englishRoom(room: Room): Room {
  const base = staticRooms.find((item) => item.id === room.id);
  if (!base) return room;
  return {
    ...room,
    name: base.name,
    hotspots: room.hotspots.map((hotspot) => {
      const match = base.hotspots.find((item) => item.id === hotspot.id);
      return match ? { ...hotspot, label: match.label } : hotspot;
    }),
  };
}

/** Bundled translations apply only to text the admin left as the bundled English. */
function localizeUnedited(room: Room, messages: PublicMessages): Room {
  const english = englishRoom(room);
  const [translated] = localizeRooms([room], messages);
  return {
    ...room,
    name: room.name === english.name ? translated.name : room.name,
    hotspots: room.hotspots.map((hotspot, index) =>
      hotspot.label === english.hotspots[index].label ? translated.hotspots[index] : hotspot,
    ),
  };
}
