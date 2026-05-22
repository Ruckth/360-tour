import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function TourOverlay({
  visitedCount,
  totalRooms,
  allRoomsVisited,
  onFinish,
}: {
  visitedCount: number;
  totalRooms: number;
  allRoomsVisited: boolean;
  onFinish: () => void;
}) {
  const navT = useTranslations("Nav");
  const tourT = useTranslations("Tour");

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4 md:top-6">
        <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md">
          {tourT("roomsExplored", { visited: visitedCount, total: totalRooms })}
        </div>
      </div>
      {allRoomsVisited ? (
        <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-4 md:bottom-28">
          <Button
            type="button"
            variant="gold"
            onClick={onFinish}
            className="rounded-full px-6 shadow-lg shadow-black/30"
          >
            {navT("book")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
