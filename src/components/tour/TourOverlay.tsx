import { useTranslations } from "@/platform/intl";
import { Button } from "@/components/ui/button";

export function TourOverlay({
  visitedCount,
  rooms,
  currentRoomId,
  navigationLocked,
  onSelectRoom,
  onFinish,
}: {
  visitedCount: number;
  rooms: readonly { id: string; name: string }[];
  currentRoomId: string;
  navigationLocked: boolean;
  onSelectRoom: (roomId: string) => void;
  onFinish: () => void;
}) {
  const navT = useTranslations("Nav");
  const tourT = useTranslations("Tour");

  return (
    <>
      <div className="pointer-events-none absolute left-3 right-16 top-4 z-20 flex min-w-0 flex-wrap items-center gap-2 md:left-6 md:top-5">
        <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md">
          {tourT("roomsExplored", { visited: visitedCount, total: rooms.length })}
        </div>
        {rooms.length > 1 ? (
          <select
            aria-label={tourT("scene")}
            aria-disabled={navigationLocked}
            value={currentRoomId}
            onChange={(event) => {
              if (!navigationLocked) onSelectRoom(event.currentTarget.value);
            }}
            className="pointer-events-auto min-h-11 min-w-0 max-w-full truncate rounded-full border border-white/25 bg-black/70 px-3 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-white"
          >
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
        ) : rooms[0] ? (
          <p className="max-w-full truncate rounded-full bg-black/50 px-3 py-2 text-sm font-semibold text-white">{rooms[0].name}</p>
        ) : null}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(7rem+env(safe-area-inset-bottom,0px))] z-20 flex justify-center px-4 md:bottom-[calc(8rem+env(safe-area-inset-bottom,0px))]">
        <Button
          type="button"
          variant="gold"
          onClick={onFinish}
          className="pointer-events-auto min-h-11 rounded-full px-6 shadow-lg shadow-black/30"
        >
          {navT("book")}
        </Button>
      </div>
    </>
  );
}
