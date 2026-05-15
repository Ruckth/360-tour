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
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4 md:top-6">
        <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md">
          {visitedCount}/{totalRooms} rooms explored
        </div>
      </div>
      {allRoomsVisited ? (
        <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-4 md:bottom-28">
          <button
            type="button"
            onClick={onFinish}
            className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-navy shadow-lg shadow-black/30 transition hover:bg-gold-light"
          >
            Book
          </button>
        </div>
      ) : null}
    </>
  );
}
