import { Html } from "@react-three/drei";
import { MoveRight } from "lucide-react";
import type { PointerEvent } from "react";
import { cn } from "@/lib/utils";

export function Hotspot({
  position,
  label,
  onClick,
  onPointerDown,
  selected,
}: {
  position: [number, number, number];
  label: string;
  onClick?: () => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  selected?: boolean;
}) {
  return (
    <Html position={position} center distanceFactor={18}>
      <button
        type="button"
        data-testid="tour-hotspot"
        onClick={onClick}
        onPointerDown={onPointerDown}
        className={cn(
          "group flex items-center gap-2 rounded-full border border-white/20 bg-black/45 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md transition hover:bg-white hover:text-black",
          selected && "ring-2 ring-gold",
        )}
      >
        <span className="flex h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_18px_rgba(214,166,72,0.9)]" />
        {label}
        <MoveRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </button>
    </Html>
  );
}
